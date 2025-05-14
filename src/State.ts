import * as vscode from 'vscode';
import { Config } from './config';
import { Dependency, IgnoreFilesProvider } from './ignoreFiles/provider';
import micromatch, { match } from 'micromatch';
import path from 'path';

function getConfig() {
	return new Config(vscode.workspace.getConfiguration('betterbreakpoints'));
}

export type State = {
	dependencies: Dependency[];
	provider: IgnoreFilesProvider;
	configuration: () => Config;

	session?: vscode.DebugSession;
	debuggerStopped: boolean;
	getCurrentPath: () => string | undefined;
	init: () => void;
	save: () => void;
	onStop: (doc: vscode.TextDocument | undefined) => void;
	match: (needle: string, haystack: string[]) => boolean;
};

function getCurrentPath() {
	const rootPath =
		vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: undefined;

	return rootPath;
}

export const state: State = {
	provider: new IgnoreFilesProvider(),
	dependencies: [],
	onStop: () => {},
	getCurrentPath,
	session: undefined,
	debuggerStopped: false,
	match: (needle, haystack) => {
		for (const item of haystack) {
			if (micromatch.contains(needle, item)) {
				return true;
			}
		}
		return false;
	},

	init: () => {
		state.dependencies = state.configuration().IgnoreBreakpointList().map(Dependency.New);

		state.provider.setDependencies(() => state.dependencies);

		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('betterbreakpoints')) {
				state.dependencies = state.configuration().IgnoreBreakpointList().map(Dependency.New);

				state.provider.refresh();
			}
		});
	},
	configuration: getConfig,
	save: async () => {
		await state.configuration().updatePatterns(
			state.dependencies.map((f) => f.label),
			vscode.ConfigurationTarget.Workspace
		);
	},
};

//@ts-ignore
global.state = () => state;
