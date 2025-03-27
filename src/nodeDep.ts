import { MyBreakpoint, MyBreakpoint } from './breakpoint';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';

export class NodeDependenciesProvider implements vscode.TreeDataProvider<Dependency> {
	constructor(private workspaceRoot: string) {}

	getTreeItem(element: Dependency): vscode.TreeItem {
		return element;
	}

	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | null | void> =
		new vscode.EventEmitter<Dependency | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | null | void> =
		this._onDidChangeTreeData.event;

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	getChildren(element?: Dependency): Thenable<Dependency[]> {
		const dep: Dependency[] = getConfig()
			.IgnoreBreakpointList()
			.map((br) => new Dependency(br, br, vscode.TreeItemCollapsibleState.None));

		return Promise.resolve(dep);
	}
}

class Dependency extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		private version: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}-${this.version}`;

		this.description = this.version;
	}

	// iconPath = {
	// 	light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
	// 	dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg'),
	// };
}
