import * as vscode from 'vscode';

export class IgnoreFilesProvider implements vscode.TreeDataProvider<Dependency> {
	private deps: () => Dependency[] = () => [];
	constructor() {}

	getTreeItem(element: Dependency): vscode.TreeItem {
		return element;
	}

	public getDependencies() {
		return this.deps;
	}
	public setDependencies(newDeps: () => Dependency[]) {
		this.deps = newDeps;
	}

	getChildren(): Thenable<Dependency[]> {
		return Promise.resolve(this.deps());
	}
	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void> =
		new vscode.EventEmitter<Dependency | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | null | void> =
		this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
}

export class Dependency extends vscode.TreeItem {
	constructor(public readonly label: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.tooltip = `${this.label}`;

		this.contextValue = 'dependency';
	}

	static New(name: string) {
		return new Dependency(name);
	}
}
