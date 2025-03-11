import assert from 'assert';
import { text } from 'express';
import * as vscode from 'vscode';

function makeName(str: string): string {
	return `debugpoints.${str}`;
}

function getBreakPointsFromSameFile(all: readonly vscode.Breakpoint[], file: string): MyBreakpoint[] {
	return all
		.map((breakpoint) => new MyBreakpoint(breakpoint))
		.filter((breakpoint) => {
			return breakpoint.Location().uri.path.slice(1).replaceAll('/', '\\') === file;
		});
}

class MyBreakpoint {
	public breakpoint: vscode.Breakpoint;
	constructor(breakpoint: vscode.Breakpoint) {
		this.breakpoint = breakpoint;
	}
	public isLog() {
		return typeof this.breakpoint.logMessage === 'undefined';
	}
	public Location() {
		//@ts-ignore
		return this.breakpoint.location as { uri: { path: string }; range: vscode.Range };
	}

	toString(): string {
		if (this.breakpoint.logMessage) {
			return this.breakpoint.logMessage;
		}

		const filename = this.Location().uri.path.split('/').at(-1);

		const line = this.Location().range.start.line;
		const char = this.Location().range.start.character;

		if (filename) {
			return `${filename} [${line}:${char}]`;
		}
		return this.breakpoint.id;
	}
}

async function logPoints() {
	const all = vscode.debug.breakpoints.map((b) => new MyBreakpoint(b));

	console.log(all);

	if (all.length === 0) {
		console.warn('no breakpoint found');
		return;
	}
	const editor = vscode.window.activeTextEditor!;

	if (!editor) {
		console.warn(`no editor to be found`);
		return;
	}

	const file = editor.document.fileName;

	// const sameFile = all.filter((breakpoint) => {
	// 	return breakpoint.Location().uri.path.slice(1).replaceAll('/', '\\') === file;
	// });

	const sameFile = all;

	const selection = await vscode.window.showQuickPick(sameFile.map((f) => f.toString()));

	if (!selection) {
		console.warn(`no item was selected`);
		return;
	}

	const br = sameFile.filter((f) => f.toString() === selection).at(0)!;

	const range = br.Location().range;

	const start = new vscode.Position(range.start.line, range.start.character);

	const rng = new vscode.Range(start, new vscode.Position(range.end.line, range.end.character));

	editor.selection = new vscode.Selection(start, start);

	editor.revealRange(rng);

	// vscode.debug.removeBreakpoints(sameFile);
}

function addConditionalBreakpointsOnFile(doc: vscode.TextDocument, regex: RegExp) {
	let match: RegExpExecArray | null;

	const text = doc.getText().toLocaleLowerCase();

	const filename = doc.fileName;

	const sameFile = getBreakPointsFromSameFile(vscode.debug.breakpoints, filename);

	const positions: { message: string; pos: vscode.Position; condition: string }[] = [];
	while ((match = regex.exec(text)) !== null) {
		const nextInd = match.index;
		const condition = match[1];
		const message = match[2];
		const pos = doc.positionAt(nextInd);

		if (!pos) {
			return;
		}
		positions.push({
			condition,
			pos,
			message,
		});
	}

	positions.forEach((pos) => {
		const br = new vscode.SourceBreakpoint(
			new vscode.Location(doc.uri, pos.pos),
			true,
			pos.condition,
			undefined,
			pos.message
		);

		const oldBreakpoint = sameFile.find((f) => f.Location().range.start.isEqual(pos.pos));

		if (oldBreakpoint) {
			vscode.debug.removeBreakpoints([oldBreakpoint.breakpoint]);
		}

		vscode.debug.addBreakpoints([br]);
	});
}

export function activate(context: vscode.ExtensionContext) {
	const other = vscode.commands.registerCommand(makeName('listBreakPoints'), logPoints);

	vscode.commands.registerCommand(makeName('addOnAssert'), () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			console.warn('no editor');
			return;
		}

		const regex = /\bassert(?:\.\w+)?\s*\(\s*([^,]+)\s*,\s*(['"][^'"]+['"])?\s*\)/g;

		addConditionalBreakpointsOnFile(editor.document, regex);
	});

	vscode.commands.registerCommand(makeName('projectAddOnAssert'), async () => {
		const editor = vscode.window.activeTextEditor;

		const regex = /\bassert(?:\.\w+)?\s*\(\s*([^,]+)\s*,\s*(['"][^'"]+['"])?\s*\)/g;

		console.log(vscode.workspace.workspaceFolders, 'folders');

		const f = await vscode.workspace.findFiles(`(**/*.cs|**/*.ts)`, `(\.gitignore)`);

		f.forEach((uri) => {
			vscode.workspace.openTextDocument(uri).then((document) => {
				// Now you have the TextDocument, and you can access its content, language, etc.
				console.log('Document opened:', document.uri.fsPath);
				console.log('Document content:', document.getText());

				addConditionalBreakpointsOnFile(document, regex);
			});
		});
	});

	context.subscriptions.push(other);
}

export function deactivate() {}
