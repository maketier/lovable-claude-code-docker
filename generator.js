import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const WORKSPACE = '/workspace';
const MAX_TURNS = 50;
const MODEL = 'claude-sonnet-4-20250514';

// System prompt with file writing guidelines
const SYSTEM_PROMPT = `You are an expert full-stack developer generating production-ready code.

## File Writing Guidelines

**Small files (<4KB):** Use write_file directly.

**Large files (>4KB, especially CSS/JS):** Use chunked writing:
1. First chunk: write_file({ path: "styles.css", content: "/* Part 1 */\\n..." }) - this overwrites/creates
2. Subsequent chunks: append_file({ path: "styles.css", content: "/* Part 2 */\\n..." })
3. Keep each chunk under 8KB

**Why this matters:** Large files can cause max_tokens truncation, resulting in incomplete writes. Using write_file for the first chunk ensures idempotent retries (overwrites on retry). Using append_file for subsequent chunks adds content incrementally.

## Best Practices
- Prefer minimal, inline styles when possible - avoid verbose CSS
- Keep CSS concise: use shorthand properties, avoid redundant rules
- Split large CSS into logical sections only when necessary
- For JavaScript, write modular code in separate files when appropriate
- Prioritize functionality over elaborate styling`;

// Track repeated failures per tool+key for circuit breaker
const failureTracker = new Map();
const MAX_REPEATED_FAILURES = 3;

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root (e.g., "src/index.js" or "README.md")'
        },
        content: {
          type: 'string',
          description: 'Complete file content to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root (use "." for root)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'append_file',
    description: 'Append content to a file. Creates the file if it does not exist. Use this for writing large files in chunks: first chunk should use write_file (to overwrite), subsequent chunks use append_file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root'
        },
        content: {
          type: 'string',
          description: 'Content to append (keep under 8KB per call)'
        }
      },
      required: ['path', 'content']
    }
  }
];

/**
 * Validate and normalize a path to ensure it stays within workspace
 */
function validatePath(inputPath) {
  // Remove leading slash if present
  const cleanPath = inputPath.replace(/^\/+/, '');

  // Block path traversal attempts
  if (cleanPath.includes('../') || cleanPath.includes('..\\')) {
    throw new Error(`Path traversal not allowed: ${inputPath}`);
  }

  // Resolve to absolute path within workspace
  const absolutePath = path.resolve(WORKSPACE, cleanPath);

  // Ensure the resolved path is still within workspace
  if (!absolutePath.startsWith(WORKSPACE)) {
    throw new Error(`Path outside workspace: ${inputPath}`);
  }

  return absolutePath;
}

/**
 * Tool handler: write_file
 */
function handleWriteFile(args) {
  try {
    // Validate content before writing
    if (args.content === undefined || args.content === null) {
      console.error(`❌ Failed to write file: content is missing/undefined`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: 'Content is missing or undefined. This usually happens when max_tokens truncates the response.',
        hint: 'Use write_file for the first chunk, then append_file for subsequent chunks. Keep chunks under 8KB.'
      };
    }
    if (typeof args.content !== 'string') {
      console.error(`❌ Failed to write file: content is not a string (got ${typeof args.content})`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: `Content must be a string, got ${typeof args.content}`,
        hint: 'Ensure content is a valid string.'
      };
    }

    const safePath = validatePath(args.path);

    // Create parent directories if needed
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write file
    fs.writeFileSync(safePath, args.content, 'utf8');

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`✅ Wrote file: ${relativePath}`);

    return {
      success: true,
      path: relativePath,
      bytes: args.content.length
    };
  } catch (error) {
    console.error(`❌ Failed to write file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: append_file
 */
function handleAppendFile(args) {
  try {
    // Validate content before appending
    if (args.content === undefined || args.content === null) {
      console.error(`❌ Failed to append file: content is missing/undefined`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: 'Content is missing or undefined. This usually happens when max_tokens truncates the response.',
        hint: 'Ensure content is provided. Keep chunks under 8KB.'
      };
    }
    if (typeof args.content !== 'string') {
      console.error(`❌ Failed to append file: content is not a string (got ${typeof args.content})`);
      return {
        success: false,
        error_code: 'INVALID_WRITE_CONTENT',
        error: `Content must be a string, got ${typeof args.content}`,
        hint: 'Ensure content is a valid string.'
      };
    }

    const safePath = validatePath(args.path);
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });

    // Append (creates if doesn't exist)
    fs.appendFileSync(safePath, args.content, 'utf8');

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`✅ Appended to file: ${relativePath} (+${args.content.length} bytes)`);

    return {
      success: true,
      path: relativePath,
      bytes_appended: args.content.length
    };
  } catch (error) {
    console.error(`❌ Failed to append file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: read_file
 */
function handleReadFile(args) {
  try {
    const safePath = validatePath(args.path);

    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `File not found: ${args.path}`
      };
    }

    const content = fs.readFileSync(safePath, 'utf8');
    const relativePath = path.relative(WORKSPACE, safePath);

    console.log(`📖 Read file: ${relativePath} (${content.length} bytes)`);

    return {
      success: true,
      path: relativePath,
      content: content
    };
  } catch (error) {
    console.error(`❌ Failed to read file: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: list_directory
 */
function handleListDirectory(args) {
  try {
    const safePath = validatePath(args.path);

    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `Directory not found: ${args.path}`
      };
    }

    const entries = fs.readdirSync(safePath, { withFileTypes: true });
    const items = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file'
    }));

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`📂 Listed directory: ${relativePath || '.'} (${items.length} items)`);

    return {
      success: true,
      path: relativePath || '.',
      items: items
    };
  } catch (error) {
    console.error(`❌ Failed to list directory: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Tool handler: create_directory
 */
function handleCreateDirectory(args) {
  try {
    const safePath = validatePath(args.path);

    fs.mkdirSync(safePath, { recursive: true });

    const relativePath = path.relative(WORKSPACE, safePath);
    console.log(`📁 Created directory: ${relativePath}`);

    return {
      success: true,
      path: relativePath
    };
  } catch (error) {
    console.error(`❌ Failed to create directory: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute a tool by name
 */
function executeTool(toolName, args) {
  switch (toolName) {
    case 'write_file':
      return handleWriteFile(args);
    case 'append_file':
      return handleAppendFile(args);
    case 'read_file':
      return handleReadFile(args);
    case 'list_directory':
      return handleListDirectory(args);
    case 'create_directory':
      return handleCreateDirectory(args);
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
  }
}

/**
 * Main generation loop
 */
async function generate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = process.env.PROMPT;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  if (!prompt) {
    throw new Error('PROMPT environment variable is required');
  }

  console.log('🔑 API key validated');
  console.log(`📝 Prompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log('');

  const client = new Anthropic({ apiKey });

  // Initial message from user
  const messages = [{
    role: 'user',
    content: prompt
  }];

  let turnCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let circuitBreakerResult = null; // Set when circuit breaker triggers

  // Main agentic loop
  while (turnCount < MAX_TURNS) {
    turnCount++;
    console.log(`\n--- Turn ${turnCount}/${MAX_TURNS} ---`);

    try {
      // Call Claude with tools
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: messages
      });

      // Track token usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      console.log(`📊 Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);
      console.log(`🛑 Stop reason: ${response.stop_reason}`);

      // Add assistant response to messages
      messages.push({
        role: 'assistant',
        content: response.content
      });

      // Check if task is complete
      if (response.stop_reason === 'end_turn') {
        console.log('\n✅ Generation complete');
        break;
      }

      // Process tool uses
      const toolUses = response.content.filter(block => block.type === 'tool_use');

      if (toolUses.length === 0) {
        console.log('\n✅ No more tools to execute, generation complete');
        break;
      }

      console.log(`🔧 Executing ${toolUses.length} tool(s)...`);

      // Execute tools and collect results
      const toolResults = [];

      for (const toolUse of toolUses) {
        console.log(`  → ${toolUse.name}(${JSON.stringify(toolUse.input).substring(0, 60)}...)`);

        const result = executeTool(toolUse.name, toolUse.input);

        // Circuit breaker: track repeated failures
        const trackingKey = `${toolUse.name}:${toolUse.input?.path || toolUse.id}`;

        if (!result.success) {
          const failures = (failureTracker.get(trackingKey) || 0) + 1;
          failureTracker.set(trackingKey, failures);

          if (failures >= MAX_REPEATED_FAILURES) {
            console.error(`\n🛑 CIRCUIT BREAKER: ${toolUse.name}("${toolUse.input?.path || toolUse.id}") failed ${failures} times. Stopping gracefully.`);
            console.error(`   Last error: ${result.error}`);
            console.error(`   Hint: ${result.hint || 'Try breaking the file into smaller chunks with write_file (first) + append_file (subsequent).'}`);

            // Set circuit breaker result for graceful exit
            circuitBreakerResult = {
              success: false,
              error_code: 'CIRCUIT_BREAKER',
              tool: toolUse.name,
              path: toolUse.input?.path || null,
              tool_use_id: toolUse.id,
              last_error: result.error,
              hint: result.hint || 'Try breaking the file into smaller chunks with write_file (first) + append_file (subsequent).',
              failures: failures
            };
            break; // Exit the for loop
          }
        } else if (toolUse.input?.path) {
          // Reset failure count on success for this path
          failureTracker.delete(trackingKey);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // If circuit breaker triggered, exit the main loop
      if (circuitBreakerResult) {
        break;
      }

      // Add tool results to messages
      messages.push({
        role: 'user',
        content: toolResults
      });

    } catch (error) {
      console.error(`\n❌ Error on turn ${turnCount}:`, error.message);

      if (error.status === 429) {
        console.error('Rate limit hit, waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      throw error;
    }
  }

  if (turnCount >= MAX_TURNS) {
    console.log(`\n⚠️ Reached maximum turns (${MAX_TURNS}), stopping`);
  }

  // Print summary (always print artifacts even on failure)
  console.log('\n================================================');
  if (circuitBreakerResult) {
    console.log('❌ Generation stopped by circuit breaker');
    console.log(`   Tool: ${circuitBreakerResult.tool}`);
    console.log(`   Path: ${circuitBreakerResult.path || 'N/A'}`);
    console.log(`   Error: ${circuitBreakerResult.last_error}`);
    console.log(`   Hint: ${circuitBreakerResult.hint}`);
  } else {
    console.log('✅ Generation finished');
  }
  console.log('📁 Contents of /workspace:');

  try {
    const result = executeTool('list_directory', { path: '.' });
    if (result.success && result.items) {
      console.log(`total ${result.items.length}`);
      result.items.forEach(item => {
        const icon = item.type === 'directory' ? '📂' : '📄';
        console.log(`${icon} ${item.name}`);
      });
    }
  } catch (error) {
    console.log('(Could not list workspace contents)');
  }

  console.log('================================================');
  console.log(`\n💰 Total tokens: ${totalInputTokens + totalOutputTokens}`);
  console.log(`   Input:  ${totalInputTokens}`);
  console.log(`   Output: ${totalOutputTokens}`);

  // Estimate cost (rough approximation for sonnet-4)
  const inputCost = (totalInputTokens / 1_000_000) * 3.0;
  const outputCost = (totalOutputTokens / 1_000_000) * 15.0;
  const totalCost = inputCost + outputCost;
  console.log(`   Cost:   ~$${totalCost.toFixed(4)}`);

  // Return result for caller
  if (circuitBreakerResult) {
    return circuitBreakerResult;
  }
  return { success: true, turns: turnCount, tokens: totalInputTokens + totalOutputTokens };
}

// Run generator
generate()
  .then((result) => {
    if (result && !result.success) {
      console.log('\n❌ Generator stopped with errors');
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log('\n✅ Generator completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Generator failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
