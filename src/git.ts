/**
 * 分支名读取。
 *
 * 刻意不调用 git 子进程：statusline 每次渲染都是新进程，fork 一次 git 要 10-20ms，
 * 而且 claude-hud 在 Windows 上就因为每帧起 git 攒出过孤儿进程（上游 #703）。
 * 直接读 .git/HEAD 这个纯文本文件即可拿到分支名，耗时可忽略。
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** HEAD 文件内容上限，正常只有几十字节，超了说明不是我们认识的格式。 */
const MAX_HEAD_BYTES = 4096;
/** 向上查找 .git 的最大层数，防御异常深的路径或符号链接环。 */
const MAX_WALK_UP = 64;

/**
 * 从一个 .git 目录读出当前分支名。
 *
 * Args:
 *   gitDir: .git 目录的绝对路径。
 *
 * Returns:
 *   分支名；detached HEAD 时返回 7 位短 sha；无法识别时返回 null。
 */
function readHead(gitDir: string): string | null {
  try {
    const headPath = join(gitDir, 'HEAD');
    if (statSync(headPath).size > MAX_HEAD_BYTES) return null;
    const raw = readFileSync(headPath, 'utf8').trim();
    // 常规情况：ref: refs/heads/<branch>
    const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(raw);
    if (refMatch?.[1]) return refMatch[1];
    // detached HEAD：文件里直接是一个 40 位（或 SHA-256 下 64 位）的 commit id
    if (/^[0-9a-f]{40,64}$/.test(raw)) return raw.slice(0, 7);
    return null;
  } catch {
    return null;
  }
}

/**
 * 从给定目录向上查找 git 仓库并返回当前分支名。
 *
 * 需要处理三种 .git 形态：
 *   1. 普通仓库：.git 是目录
 *   2. worktree / submodule：.git 是文件，内容为 "gitdir: <路径>"，要跳转过去再读
 *   3. 不在仓库里：一路走到根目录都没找到
 *
 * Args:
 *   startDir: 起始目录（通常是 stdin 的 workspace.current_dir）。
 *
 * Returns:
 *   分支名或短 sha；不在 git 仓库中、或读取失败时返回 null。
 */
export function getBranch(startDir: string | null | undefined): string | null {
  if (!startDir) return null;
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const dotGit = join(dir, '.git');
    try {
      const st = statSync(dotGit);
      if (st.isDirectory()) return readHead(dotGit);
      if (st.isFile()) {
        // worktree 形态：.git 文件里写着真正的 git 目录位置，可能是相对路径
        const raw = readFileSync(dotGit, 'utf8').trim();
        const m = /^gitdir:\s*(.+)$/.exec(raw);
        if (!m?.[1]) return null;
        const target = m[1].trim();
        return readHead(isAbsolute(target) ? target : resolve(dir, target));
      }
    } catch {
      // 这一层没有 .git，继续往上找
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
