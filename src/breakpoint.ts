import * as vscode from 'vscode';

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
