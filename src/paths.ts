/**
 * Claude Code 配置目录的解析。
 *
 * Claude Code 允许用 CLAUDE_CONFIG_DIR 覆盖默认的 ~/.claude，
 * 本插件所有落盘路径（配置文件、launcher）都必须走这里，否则多配置目录的用户会读错文件。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 返回 Claude Code 的配置目录。
 *
 * Returns:
 *   CLAUDE_CONFIG_DIR 环境变量的值（若已设置且非空），否则 ~/.claude。
 */
export function getClaudeConfigDir(): string {
  const override = process.env['CLAUDE_CONFIG_DIR']?.trim();
  if (override) return override;
  return join(homedir(), '.claude');
}

/**
 * 返回 ~/.claude.json 的路径。
 *
 * 注意这个文件跟配置目录是兄弟关系而非父子关系：配置目录是 <X>/.claude 时，
 * 这个文件就是 <X>/.claude.json。Claude Code 自己也是这么拼的。
 *
 * Returns:
 *   Claude Code 主配置文件的绝对路径。
 */
export function getClaudeJsonPath(): string {
  return `${getClaudeConfigDir()}.json`;
}

/**
 * 返回本插件的私有目录（存放 config.json 与 launcher.mjs）。
 *
 * Returns:
 *   {配置目录}/claudemeter 的绝对路径。
 */
export function getMeterDir(): string {
  return join(getClaudeConfigDir(), 'claudemeter');
}

/**
 * 返回本插件配置文件的路径。
 *
 * Returns:
 *   {配置目录}/claudemeter/config.json 的绝对路径。
 */
export function getConfigPath(): string {
  return join(getMeterDir(), 'config.json');
}
