import { Socket } from "net";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createConnection,
  TextDocuments,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocumentSyncKind,
  InitializeResult,
  Diagnostic,
} from "vscode-languageserver/node";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// TCP Socket connected
const clients: Map<TextDocument, Socket> = new Map();
const port = 54800;

connection.onInitialize(() => {
  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
    },
  };

  return result;
});

connection.onInitialized(() => {
  console.log("init");
  // TODO: do not trigger if only change is space or new line
});

documents.onDidOpen(({ document }) => {
  const client = new Socket();
  clients.set(document, client);

  client.connect({ port });

  client.on("connect", () => {
    console.log("PapyrusLint Server started");
  });

  client.on("close", () => {
    console.log("PapyrusLint Server disconnected");
    client.end();
  });

  client.on("error", (err) => {
    console.log("Server error", err);
    client.end();
  });

  client.on("data", (messageChars) => {
    const message = messageChars.toString();
    try {
      const data = JSON.parse(message);
      const diagnostics: Diagnostic[] = [];

      if (!("problems" in data.result)) {
        diagnostics.push({
          message: data.result.message,
          severity: data.result.isException
            ? DiagnosticSeverity.Error
            : DiagnosticSeverity.Information,
          range: {
            start: data.result.start,
            end: data.result.end,
          },
          source: "papyruslint(exception)",
        });
      } else {
        for (const problem of data.result.problems) {
          diagnostics.push({
            message: problem.message,
            severity: toSeverity(problem.severity),
            range: {
              start: problem.start,
              end: problem.end,
            },
            source: `papyruslint(${problem.ruleName})`,
          });
        }
      }

      connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } catch (e) {
      console.log("error", message);
      console.error("Linter error:", e);
    }
  });
});

documents.onDidClose(({ document }) => {
  const client = clients.get(document);

  client?.end();
});

documents.onDidChangeContent(({ document }) => {
  const text = document.getText();
  const filename = path.parse(document.uri).name;
  const client = clients.get(document);

  client?.write(`${filename};-[papyruslint]-;${text}`);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

connection.onShutdown(() => {
  console.log("Shutting down PapyrusLint Server");
  for (const client of clients.values()) {
    client.end();
  }
});

const toSeverity = (str: string): DiagnosticSeverity => {
  switch (str) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "information":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
};
