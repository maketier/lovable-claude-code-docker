import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import process from "process";

const WORKSPACE = process.env.OUTPUT_DIR || "/workspace";
const MAX_TURNS = Number(process.env.MAX_TURNS || "50");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

const apiKey = process.env.ANTHROPIC_API_KEY;
const prompt = process.env.PROMPT;

if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
if (!prompt) throw new Error("PROMPT environment variable is required");

fs.mkdirSync(WORKSPACE, { recursive: true });

const TOOLS = [
  {
    name: "write_file",
    description: "Write content to a file in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "read_file",
    description: "Read a file in the workspace.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  },
  {
    name: "list_directory",
    description: "List a workspace directory.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  },
  {
    name: "create_directory",
    description: "Create a workspace directory.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  }
];

function validatePath(inputPath) {
  const clean = String(inputPath).replace(/^\/+/, "");
  if (clean.includes("..")) throw new Error("Path traversal not allowed");

  const abs = path.resolve(WORKSPACE, clean);
  const base = path.resolve(WORKSPACE);

  if (!(abs === base || abs.startsWith(base + path.sep))) {
    throw new Error("Path outside workspace");
  }
  return abs;
}

function handleWriteFile({ path: p, content }) {
  const abs = validatePath(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { success: true, path: path.relative(WORKSPACE, abs) };
}

function handleReadFile({ path: p }) {
  const abs = validatePath(p);
  return { success: true, content: fs.readFileSync(abs, "utf8") };
}

function handleListDirectory({ path: p }) {
  const abs = validatePath(p);
  const items = fs.readdirSync(abs, { withFileTypes: true }).map(e => ({
    name: e.name,
    type: e.isDirectory() ? "directory" : "file"
  }));
  return { success: true, items };
}

function handleCreateDirectory({ path: p }) {
  const abs = validatePath(p);
  fs.mkdirSync(abs, { recursive: true });
  return { success: true };
}

function execTool(name, args) {
  switch (name) {
    case "write_file": return handleWriteFile(args);
    case "read_file": return handleReadFile(args);
    case "list_directory": return handleListDirectory(args);
    case "create_directory": return handleCreateDirectory(args);
    default: return { success: false, error: "Unknown tool" };
  }
}

async function run() {
  const client = new Anthropic({ apiKey });

  const messages = [{
    role: "user",
    content: `Create a complete runnable project using tools. Always write files.\n\n${prompt}`
  }];

  for (let i = 0; i < MAX_TURNS; i++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: TOOLS,
      messages
    });

    messages.push({ role: "assistant", content: res.content });

    const tools = res.content.filter(b => b.type === "tool_use");
    if (!tools.length) break;

    const results = tools.map(t => ({
      type: "tool_result",
      tool_use_id: t.id,
      content: JSON.stringify(execTool(t.name, t.input))
    }));

    messages.push({ role: "user", content: results });
  }

  console.log("\n📁 Files in workspace:");
  console.log(fs.readdirSync(WORKSPACE));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
