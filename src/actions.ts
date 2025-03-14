import * as vscode from 'vscode';
import { MyBreakpoint } from './breakpoint';

export class BreakPointAction {
	private action: (breakpoint: MyBreakpoint) => void;
	private getFn: () => MyBreakpoint[];
	private filter: (breakpoint: MyBreakpoint) => boolean;

	constructor() {
		this.action = () => {};
		this.filter = () => false;
		this.getFn = () => [];
	}

	public SetAction(ac: (breakpoint: MyBreakpoint) => void): BreakPointAction {
		this.action = ac;
		return this;
	}

	public setGetter(ac: () => MyBreakpoint[]): BreakPointAction {
		this.getFn = ac;
		return this;
	}

	public setFilter(ac: (b: MyBreakpoint) => boolean): BreakPointAction {
		this.filter = ac;
		return this;
	}

	Use(): void {
		const breakpoints = this.getFn().filter(this.filter);

		for (var br of breakpoints) {
			this.action(br);
		}
	}
}

export function filterHitCondition(b: MyBreakpoint): boolean {
	return b.IsHitCondition();
}
export function filterConditional(b: MyBreakpoint): boolean {
	return b.IsConditional();
}

export function filterBreakpoint(b: MyBreakpoint): boolean {
	return b.isBreakPoint();
}

export function filterLog(b: MyBreakpoint): boolean {
	return b.isLog();
}
export function getBreakpointFromWorkspace() {
	let filepath = vscode.workspace.workspaceFolders;

	return vscode.debug.breakpoints
		.map((b) => new MyBreakpoint(b))
		.filter((b) => {
			return filepath?.some((w) => b.inWorkspace(w.uri.path));
		});
}

export function getBreakpointFromFile(filepath?: string) {
	filepath ??= vscode.workspace.workspaceFile?.fsPath;

	if (vscode.window.activeTextEditor) {
		filepath = vscode.window.activeTextEditor.document.uri.path;
	}

	return vscode.debug.breakpoints.map((b) => new MyBreakpoint(b)).filter((b) => b.Path() === filepath);
}
export function enableBreakPoint(b: MyBreakpoint) {
	const location = new vscode.Location(vscode.Uri.file(b.Location().uri.path), b.Location().range);
	const breakpoint = new vscode.SourceBreakpoint(
		location,
		false,
		b.Condition(),
		b.HitCondition(),
		b.LogMessage()
	);

	vscode.debug.removeBreakpoints([b.breakpoint]);

	vscode.debug.addBreakpoints([breakpoint]);
}
export function disableBreakpoint(b: MyBreakpoint) {
	const location = new vscode.Location(vscode.Uri.file(b.Location().uri.path), b.Location().range);
	const breakpoint = new vscode.SourceBreakpoint(
		location,
		false,
		b.Condition(),
		b.HitCondition(),
		b.LogMessage()
	);

	vscode.debug.removeBreakpoints([b.breakpoint]);

	vscode.debug.addBreakpoints([breakpoint]);
}
