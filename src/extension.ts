import * as vscode from 'vscode';
import { parseDocument } from 'yaml';

/**
 * Extracts prompt blocks from the YAML text.
 * A prompt block is detected when a line exactly matches an indent followed by "prompt:" and ">".
 * The entire block (prompt line plus all subsequent lines with more indent) is replaced
 * with a one-line placeholder like:
 *
 *   {indent}prompt: "@@PROMPT_BLOCK_0@@"
 *
 * and the original block is stored.
 */
function extractPromptBlocks(text: string): { modifiedText: string; blocks: string[] } {
	const lines = text.split(/\r?\n/);
	const blocks: string[] = [];
	const modifiedLines: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const promptMatch = line.match(/^(\s*)prompt:\s*>\s*$/);
		if (promptMatch) {
			const baseIndent = promptMatch[1];
			const originalBlockLines = [line];
			i++;
			// Collect all lines that are indented more than the prompt line's indent,
			// or are blank (preserve them as part of the block)
			while (i < lines.length) {
				const currentLine = lines[i];
				if (currentLine.trim() === '') {
					originalBlockLines.push(currentLine);
					i++;
					continue;
				}
				const currentIndentMatch = currentLine.match(/^(\s*)/);
				if (currentIndentMatch && currentIndentMatch[1].length > baseIndent.length) {
					originalBlockLines.push(currentLine);
					i++;
				} else {
					break;
				}
			}
			const originalBlock = originalBlockLines.join('\n');
			const placeholder = `${baseIndent}prompt: "@@PROMPT_BLOCK_${blocks.length}@@"`;
			blocks.push(originalBlock);
			modifiedLines.push(placeholder);
		} else {
			modifiedLines.push(line);
			i++;
		}
	}
	return { modifiedText: modifiedLines.join('\n'), blocks };
}

/**
 * Restores placeholders with the original prompt blocks.
 * Looks for lines matching: {indent}prompt: "@@PROMPT_BLOCK_{index}@@"
 * and replaces them with the original block.
 */
function restorePromptBlocks(formattedText: string, blocks: string[]): string {
	return formattedText.replace(
		/^(?<indent>\s*)prompt:\s*"@@PROMPT_BLOCK_(\d+)@@"\s*$/gm,
		(match, indent, index) => {
			const originalBlock = blocks[Number(index)];
			return originalBlock;
		}
	);
}

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('yaml-formatter.formatYaml', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'yaml') {
			const originalText = editor.document.getText();
			// Extract prompt blocks and replace them with placeholders.
			const { modifiedText, blocks } = extractPromptBlocks(originalText);

			try {
				// Parse and re-serialize the modified YAML.
				const doc = parseDocument(modifiedText);
				const formattedYaml = doc.toString({ indent: 2, lineWidth: -1 });
				// Restore the original prompt blocks.
				const finalYaml = restorePromptBlocks(formattedYaml, blocks);

				await editor.edit(editBuilder => {
					const fullRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(originalText.length)
					);
					editBuilder.replace(fullRange, finalYaml);
				});
			} catch (error) {
				vscode.window.showErrorMessage("Invalid YAML format.");
			}
		}
	});
	context.subscriptions.push(disposable);
}

export function deactivate() { }
