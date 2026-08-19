import { Bash, defineCommand } from 'just-bash/browser';
import { collectPageFiles, runBrowserCommand } from './browser-tools.ts';
import { limitedFetch } from './http.ts';
import { errorText } from './protocol.ts';

const README = `# chrome-fx workspace

This is an ephemeral in-browser workspace. fx talks to it through \`terminal.exec\`.
The shell is just-bash. There is no git, Node, npm, Python, or host OS.

## Current page

These files refresh when you read them:

- \`page/url.txt\` \`page/title.txt\` \`page/meta.json\`
- \`page/text.txt\` visible text
- \`page/html.html\` page HTML
- \`page/a11y.md\` heading / control tree
- \`tabs.json\` tabs in the current window

## Drive the browser

\`\`\`
browser help
browser tabs
browser info
browser snapshot
browser click "text=Sign in"
browser type "#q" "search query"
browser press Enter
browser eval "document.title"
js document.body.style.outline = "3px solid red"
browser navigate example.com
browser fetch https://example.com -o /workspace/notes/page.html
\`\`\`

\`js <code>\` is an alias for \`browser eval\`. It runs in the page MAIN world.

Selectors: CSS, \`#id\`, \`text=Visible label\`, or \`//xpath\`.

## Shell

rg, sed, awk, jq, yq, find, mkdir, mv, and redirection work against this
filesystem. Git, Node, npm, Python, curl, and the host OS are unavailable.
Keep command output small; fx previews are capped at 64 KiB.
`;

const AGENTS = `# chrome-fx

You are fx inside a Chrome extension overlay. The workspace is the current browser tab, not a git checkout or the host OS.

The default identity text may call you a local coding CLI. That is wrong here. You cannot see the user's disk, git, Node, npm, Python, or a real system shell.

## How you act

You have one tool: \`terminal\` with \`action=exec\`. Commands run in an in-memory just-bash at \`/workspace\` (\`HOME=/home/visitor\`). Previews are capped at 64 KiB.

## Drive the current page

These custom CLIs are real. Use them when the user wants you to inspect or operate the page.

- \`browser help\` — full command list
- \`browser tabs\` / \`browser tab <id>\` / \`browser info\`
- \`browser navigate <url>\` / \`browser new [url]\` / \`browser close [id]\`
- \`browser back\` / \`browser forward\` / \`browser reload\`
- \`browser snapshot\`
- \`browser click <selector>\` / \`browser type <selector> <text>\` / \`browser press <Key>\`
- \`browser hover <selector>\` / \`browser focus <selector>\` / \`browser scroll\` / \`browser wait <selector>\` / \`browser select <selector> <value>\`
- \`browser eval <javascript>\` or \`js <javascript>\` — runs in the page MAIN world
- \`browser text|html|attr <selector>\`
- \`browser cookies\` / \`browser screenshot\` / \`browser fetch <url>\`

Selectors: CSS, \`#id\`, \`text=Visible label\`, or \`//xpath\`.

Default target is the tab that opened this panel. \`chrome://\` and the Chrome Web Store cannot be injected.

If the user asks you to operate the page or run JavaScript, use \`browser\` / \`js\`. Do not say you cannot.

## Live page files

These refresh automatically before every command:

- \`page/url.txt\` \`page/title.txt\` \`page/meta.json\`
- \`page/text.txt\` visible text
- \`page/html.html\` page HTML
- \`page/a11y.md\` heading / control tree
- \`tabs.json\` tabs in the current window

Read \`page/a11y.md\` or \`page/text.txt\` before guessing. Confirm actions with snapshot or text.

## just-bash CLIs

Available: \`ls\`, \`cat\`, \`rg\`, \`grep\`, \`sed\`, \`awk\`, \`jq\`, \`yq\`, \`xan\`, \`find\`, \`head\`, \`tail\`, \`sort\`, \`uniq\`, \`cut\`, \`tr\`, \`wc\`, \`mkdir\`, \`mv\`, \`cp\`, \`rm\`, \`tree\`, \`diff\`, \`base64\`, \`html-to-markdown\`, \`sqlite3\`, \`help\`, and similar Unix text tools.

Not available: \`git\`, \`node\`, \`npm\`, \`python\`, \`python3\`, \`curl\`, \`js-exec\`, \`gzip\`, background jobs, or host paths outside \`/workspace\`.

Stay inside \`/workspace\`. Prefer CSS or \`text=\` selectors from the a11y tree.
`;

export function createWorkspace() {
  const browserCommand = defineCommand('browser', async (args) => {
    if (args[0] === 'fetch' && args.includes('-o')) {
      return fetchToFile(bash, args);
    }
    return runBrowserCommand(args);
  });
  const jsCommand = defineCommand('js', async (args) => runBrowserCommand(['eval', ...args]));

  const bash = new Bash({
    cwd: '/workspace',
    env: {
      HOME: '/home/visitor',
      USER: 'visitor',
      PWD: '/workspace',
    },
    files: {
      '/workspace/README.md': README,
      '/workspace/AGENTS.md': AGENTS,
      '/home/visitor/.fx/AGENTS.md': AGENTS,
      '/workspace/notes/.keep': '',
      '/home/visitor/.keep': '',
      '/workspace/page/url.txt': '',
      '/workspace/page/title.txt': '',
      '/workspace/page/text.txt': '',
      '/workspace/page/html.html': '',
      '/workspace/page/a11y.md': '',
      '/workspace/page/meta.json': '{}\n',
      '/workspace/tabs.json': '[]\n',
    },
    customCommands: [browserCommand, jsCommand],
  });

  return {
    info: {
      version: 1 as const,
      root: '/workspace',
      cwd: '/workspace',
      home: '/home/visitor',
      gitAvailable: false as const,
      ephemeral: true as const,
    },
    permission: 'allow-sandboxed' as const,
    async exec({
      command,
      signal,
      timeoutMs,
      outputLimitBytes,
    }: {
      command: string;
      cwd: string;
      signal: AbortSignal;
      timeoutMs: number;
      outputLimitBytes: number;
    }) {
      const files = await collectPageFiles();
      for (const [path, content] of Object.entries(files)) {
        await bash.writeFile(path, content);
      }
      const timeout = typeof timeoutMs === 'number' && timeoutMs > 0
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
      const combined = timeout ? AbortSignal.any([signal, timeout]) : signal;
      try {
        const result = await bash.exec(command, { cwd: '/workspace', signal: combined });
        const limit = outputLimitBytes > 0 ? outputLimitBytes : 64 * 1024;
        return {
          stdout: clip(result.stdout, limit),
          stderr: clip(result.stderr, limit),
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (combined.aborted) {
          return { stdout: '', stderr: 'command aborted\n', exitCode: 130 };
        }
        throw new Error(errorText(error));
      }
    },
  };
}

async function fetchToFile(bash: Bash, args: string[]) {
  const outputFlag = args.indexOf('-o');
  const dest = args[outputFlag + 1];
  const url = args.find((part, index) => index > 0 && part !== '-o' && part !== dest);
  if (!url || !dest) {
    return { stdout: '', stderr: 'usage: browser fetch <url> -o /workspace/file\n', exitCode: 1 };
  }
  if (!dest.startsWith('/workspace/') || dest.includes('..')) {
    return { stdout: '', stderr: 'destination must be a path under /workspace\n', exitCode: 1 };
  }
  try {
    const response = await limitedFetch(url);
    await bash.writeFile(dest, response.text);
    return {
      stdout: `wrote ${response.text.length} bytes to ${dest} (http ${response.status})\n`,
      stderr: '',
      exitCode: response.ok ? 0 : 1,
    };
  } catch (error) {
    return { stdout: '', stderr: `${errorText(error)}\n`, exitCode: 1 };
  }
}

function clip(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length} bytes]\n`;
}
