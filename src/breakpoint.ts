import * as assert from 'assert';
import * as vscode from 'vscode';
import { getBreakpointFromFile } from './actions';
import { getCurrentPath } from './extension';

export const oneTimeMessage = 'true && 1 == 1';

type DebugLocation = {
	uri: {
		$mid: number;
		fsPath: string;
		_sep: number;
		external: string;
		path: string;
		scheme: string;
	};
	range: vscode.Range;
};

export class MyBreakpoint {
	public breakpoint: vscode.Breakpoint;
	private doc: vscode.TextDocument | undefined;
	constructor(breakpoint: vscode.Breakpoint) {
		this.breakpoint = breakpoint;
	}

	public isBreakPoint() {
		return !this.isLog() && !this.IsConditional() && !this.IsHitCondition();
	}

	public IsHitCondition(): boolean {
		return typeof this.breakpoint.hitCondition !== 'undefined';
	}
	public Enabled(): boolean {
		return this.breakpoint.enabled;
	}

	public HitCondition(): string | undefined {
		return this.breakpoint.hitCondition;
	}
	public IsConditional(): boolean {
		return typeof this.breakpoint.condition !== 'undefined';
	}

	public Condition(): string | undefined {
		return this.breakpoint.condition;
	}
	public isLog() {
		return typeof this.breakpoint.logMessage !== 'undefined';
	}
	public LogMessage(): string | undefined {
		return this.breakpoint.logMessage;
	}

	public isOneTime() {
		return this.breakpoint.condition === oneTimeMessage;
	}
	public FileName(): string {
		return this.Location().uri.path.split('/').at(-1) ?? '';
	}

	public Path(): string {
		return this.Location().uri.path;
	}
	public Location(): DebugLocation {
		//@ts-ignore
		return this.breakpoint.location as DebugLocation;
	}

	toString(): string {
		const filename = this.Location().uri.path.split('/').at(-1);

		const line = this.Location().range.start.line;
		const char = this.Location().range.start.character;

		if (this.breakpoint.logMessage) {
			return `${this.breakpoint.logMessage} [${line}:${char}]`;
		}

		if (filename) {
			return `${filename} [${line}:${char}]`;
		}
		return this.breakpoint.id;
	}

	async Document() {
		if (this.doc) {
			return this.doc;
		}

		return vscode.workspace.openTextDocument(vscode.Uri.file(this.Location().uri.path)).then((doc) => {
			this.doc = doc;
			return doc;
		});
	}
	inWorkspace(uri: string): boolean {
		return this.Location().uri.path.startsWith(uri) || this.Location().uri.path === uri;
	}

	SamePath(uri: string): boolean {
		return this.Location().uri.path === uri;
	}
}

export async function goTobreakpoint(points: MyBreakpoint[]) {
	const editor = vscode.window.activeTextEditor;

	if (editor) {
		const editorPath = editor.document.uri.path;
		points = points.sort((a, b) => (a.Location().uri.path === editorPath ? -1 : 1));
	}

	let basePath = '';
	if (vscode.workspace.workspaceFolders) {
		basePath = vscode.workspace.workspaceFolders.find((i) => i)?.uri.path || '';
	}

	let quickPickItems: vscode.QuickPickItem[] = points.map((f) => ({
		label: f.toString(),
		description: f.Location().uri.path.replace(basePath, ''),
	}));
	const promises = await Promise.allSettled(points.map(async (f) => f.Document()));

	const pick = vscode.window.createQuickPick();
	pick.ignoreFocusOut = true;

	pick.items = quickPickItems;
	pick.activeItems = [pick.items[0]];

	pick.onDidChangeActive(async (selection) => {
		const selected = selection[0];

		pick.activeItems = [selected];

		const item = points.find((x) => x.toString() === selected.label);
		assert(item, `there is no item with the selected string ${selected.label}`);

		var uri = vscode.Uri.file(item.Location().uri.path);

		const doc = promises.find(
			(promise) => promise.status === 'fulfilled' && promise.value.uri.path === uri.path
		);
		assert(doc, 'document is not in the documents');

		if (doc.status === 'rejected') {
			return;
		}

		await vscode.window.showTextDocument(doc.value, {
			preserveFocus: true,
		});

		if (editor) {
			const range = item.Location().range;
			editor.selection = new vscode.Selection(range.start, range.start);
			editor.revealRange(range);
		}
	});

	pick.onDidAccept(pick.hide);
	pick.show();
}

export async function logPoints() {
	const workspace = vscode.workspace;

	if (!workspace) {
		return;
	}

	let basePath: string | undefined = getCurrentPath();

	if (!basePath) {
		return;
	}

	const uniqueBreakpoints = Array.from(
		new Set(
			vscode.debug.breakpoints
				.map((b) => new MyBreakpoint(b))
				.filter((breakpoint) => breakpoint.inWorkspace(basePath))
		)
	);

	goTobreakpoint(uniqueBreakpoints);
}

export function addConditionalBreakpointsOnFile(doc: vscode.TextDocument, regex: RegExp) {
	let match: RegExpExecArray | null;

	const text = doc.getText().toLocaleLowerCase();

	const sameFile = getBreakpointFromFile(doc.uri.path);

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

	for (const pos of positions) {
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
	}
}
