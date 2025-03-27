import * as vscode from 'vscode';
import { addConditionalBreakpointsOnFile, logPoints, oneTimeMessage } from './breakpoint';
import {
	BreakPointAction,
	filterLog,
	getBreakpointFromFile,
	disableBreakpoint,
	enableBreakPoint,
	filterBreakpoint,
	filterConditional,
	filterHitCondition,
	getBreakpointFromWorkspace,
	filterOneTime,
} from './actions';
import { getConfig } from './config';
import * as assert from 'assert';
import { NodeDependenciesProvider } from './nodeDep';

function makeName(str: string): string {
	return `debugpoints.${str}`;
}
export function getCurrentPath() {
	return (
		vscode.workspace.workspaceFolders?.at(0)?.uri.path ??
		vscode.workspace.workspaceFile?.path ??
		vscode.window.activeTextEditor?.document.uri.path
	);
}

export function activate(context: vscode.ExtensionContext) {
	const rootPath =
		vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: undefined;

	if (!rootPath) {
		return;
	}

	vscode.window.registerTreeDataProvider('nodeDependencies', new NodeDependenciesProvider(rootPath));

	vscode.window.createTreeView('nodeDependencies', {
		treeDataProvider: new NodeDependenciesProvider(rootPath),
	});

	function addCommand(name: string, fn: () => void): void {
		context.subscriptions.push(vscode.commands.registerCommand(name, fn));
	}

	let tempPaths: Set<string> = new Set<string>();

	vscode.workspace.onDidOpenTextDocument(async (document) => {
		//sometimes vscode opens the file on the .git file?
		let path = vscode.Uri.file(document.uri.path.replace('.git', ''));

		const ignorePatterns = getConfig().IgnoreBreakpointList();

		const ignoreRegex = ignorePatterns.map((pattern) => new RegExp('^' + pattern.replace('*', '.*') + '$'));

		if (tempPaths.has(path.path)) {
			tempPaths.delete(path.path);

			// Log matches for debugging purposes
			ignoreRegex.forEach((p) => {
				const matchResult = path.path.match(p);
				console.log(`Regex: ${p}, Match: ${matchResult}`);
			});

			// If any regex matches path.path, execute the commands
			if (ignoreRegex.length > 0 && ignoreRegex.some((p) => path.path.match(p))) {
				vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
					vscode.commands.executeCommand('workbench.action.debug.continue');
				});
			}
		}
	});

	vscode.debug.registerDebugAdapterTrackerFactory('*', {
		createDebugAdapterTracker(session) {
			return {
				onDidSendMessage: async (message) => {
					if (
						message?.command?.toLowerCase() === 'stacktrace' &&
						message.body.stackFrames.length === 1
					) {
						const f: {
							canRestart: boolean;
							column: number;
							id: number;
							line: number;
							name: string;
							presentationHint: string;
							source: {
								name: string;
								path: string;
								sourceReference: number;
							};
						} =
							//@ts-expect-error
							message.body.stackFrames.find((s) => s);
						tempPaths.add(vscode.Uri.file(f.source.path).path);
					}
					if (message.event === 'stopped' && message.body.reason === 'breakpoint') {
						const hitIds: number[] = message.body.hitBreakpointIds;

						assert(
							Array.isArray(hitIds) && hitIds.every((n) => !Number.isNaN(n)),
							'invalid array'
						);
						getBreakpointFromWorkspace().map((br) => {
							return vscode.debug.activeDebugSession
								?.getDebugProtocolBreakpoint(br.breakpoint)
								.then((f) => {
									if (
										!f ||
										typeof f !== 'object' ||
										!('id' in f) ||
										typeof f.id !== 'number' ||
										!hitIds.includes(f.id) ||
										!br.isOneTime()
									) {
										return;
									}

									vscode.debug.removeBreakpoints([br.breakpoint]);

									hitIds.filter((id) => id === f.id);
								});
						});
					}
				},
			};
		},
	});

	addCommand(makeName('addTriggered'), () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			return;
		}
		const doc = editor.document;

		const cursor = editor.selection.active;

		const sameLine = getBreakpointFromFile().filter(
			(b) => b.Location().range.start.line === cursor.line && b.isOneTime()
		);

		if (sameLine.length === 0) {
			vscode.debug.addBreakpoints([
				new vscode.SourceBreakpoint(
					new vscode.Location(doc.uri, cursor),
					true,
					oneTimeMessage,
					undefined
				),
			]);
			return;
		}
		vscode.debug.removeBreakpoints(sameLine.map((b) => b.breakpoint));
	});

	addCommand(makeName('listBreakPoints'), () => logPoints);

	addCommand(makeName('addOnAssert'), () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const regex = /\bassert(?:\.\w+)?\s*\(\s*([^,]+)\s*,\s*(['"][^'"]+['"])?\s*\)/g;
		addConditionalBreakpointsOnFile(editor.document, regex);
	});
	addCommand(makeName('projectAddOnAssert'), async () => {
		const editor = vscode.window.activeTextEditor;
		const regex = /\bassert(?:\.\w+)?\s*\(\s*([^,]+)\s*,\s*(['"][^'"]+['"])?\s*\)/g;
		(await vscode.workspace.findFiles(`**/*.cs`, `(\.gitignore)`)).forEach((uri) => {
			vscode.workspace.openTextDocument(uri).then((document) => {
				// Now you have the TextDocument, and you can access its content, language, etc.
				addConditionalBreakpointsOnFile(document, regex);
			});
		});
	});
	//logpointActions
	addCommand(makeName('remove.logpoints.file'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterLog)
			.setGetter(getBreakpointFromFile)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.logpoints.file'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterLog)
			.Use();
	});
	addCommand(makeName('enable.logpoints.file'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterLog)
			.Use();
	});
	addCommand(makeName('remove.breakpoints.file'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterBreakpoint)
			.setGetter(getBreakpointFromFile)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.breakpoints.file'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterBreakpoint)
			.Use();
	});
	addCommand(makeName('enable.breakpoints.file'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterBreakpoint)
			.Use();
	});
	addCommand(makeName('remove.conditionals.file'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterConditional)
			.setGetter(getBreakpointFromFile)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.conditionals.file'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterConditional)
			.Use();
	});
	addCommand(makeName('enable.conditionals.file'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterConditional)
			.Use();
	});
	addCommand(makeName('remove.hitConditionals.file'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterHitCondition)
			.setGetter(getBreakpointFromFile)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.hitConditionals.file'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterHitCondition)
			.Use();
	});
	addCommand(makeName('enable.hitConditionals.file'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromFile)
			.setFilter(filterHitCondition)
			.Use();
	});
	addCommand(makeName('remove.all.file'), async () => {
		return new BreakPointAction()
			.setGetter(getBreakpointFromFile)
			.SetAction((b) => vscode.debug.removeBreakpoints([b.breakpoint]))
			.Use();
	});
	addCommand(makeName('disable.all.file'), async () => {
		new BreakPointAction().SetAction(disableBreakpoint).setGetter(getBreakpointFromFile).Use();
	});
	addCommand(makeName('enable.all.file'), async () => {
		new BreakPointAction().SetAction(enableBreakPoint).setGetter(getBreakpointFromFile).Use();
	});

	addCommand(makeName('remove.oneTime.file'), async () => {
		return new BreakPointAction()
			.setGetter(getBreakpointFromFile)
			.setFilter(filterOneTime)
			.SetAction((b) => vscode.debug.removeBreakpoints([b.breakpoint]))
			.Use();
	});
	addCommand(makeName('disable.oneTime.file'), async () => {
		new BreakPointAction()
			.setFilter(filterOneTime)
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromFile)
			.Use();
	});
	addCommand(makeName('enable.oneTime.file'), async () => {
		new BreakPointAction()
			.setFilter(filterOneTime)
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromFile)
			.Use();
	});
	//workspace actions
	addCommand(makeName('remove.logpoints.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterLog)
			.setGetter(getBreakpointFromWorkspace)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.logpoints.workspace'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterLog)
			.Use();
	});
	addCommand(makeName('enable.logpoints.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterLog)
			.Use();
	});
	addCommand(makeName('remove.breakpoints.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.breakpoints.workspace'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterBreakpoint)
			.Use();
	});
	addCommand(makeName('enable.breakpoints.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterBreakpoint)
			.Use();
	});
	addCommand(makeName('remove.conditionals.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterConditional)
			.setGetter(getBreakpointFromWorkspace)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.conditionals.workspace'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterConditional)
			.Use();
	});
	addCommand(makeName('enable.conditionals.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterConditional)
			.Use();
	});
	addCommand(makeName('remove.hitConditionals.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterHitCondition)
			.setGetter(getBreakpointFromWorkspace)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.hitConditionals.workspace'), async () => {
		new BreakPointAction()
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterHitCondition)
			.Use();
	});
	addCommand(makeName('enable.hitConditionals.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterHitCondition)
			.Use();
	});
	addCommand(makeName('remove.all.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc.setGetter(getBreakpointFromWorkspace).SetAction((b) => {
			vscode.debug.removeBreakpoints([b.breakpoint]);
		});
		removeAc.Use();
	});
	addCommand(makeName('disable.all.workspace'), async () => {
		new BreakPointAction().SetAction(disableBreakpoint).setGetter(getBreakpointFromWorkspace).Use();
	});
	addCommand(makeName('enable.all.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterHitCondition)
			.Use();
	});

	addCommand(makeName('remove.oneTime.workspace'), async () => {
		const removeAc = new BreakPointAction();
		removeAc
			.setFilter(filterOneTime)
			.setGetter(getBreakpointFromWorkspace)
			.SetAction((b) => {
				vscode.debug.removeBreakpoints([b.breakpoint]);
			});
		removeAc.Use();
	});
	addCommand(makeName('disable.oneTime.workspace'), async () => {
		new BreakPointAction()
			.setFilter(filterOneTime)
			.SetAction(disableBreakpoint)
			.setGetter(getBreakpointFromWorkspace)
			.Use();
	});
	addCommand(makeName('enable.oneTime.workspace'), async () => {
		new BreakPointAction()
			.SetAction(enableBreakPoint)
			.setGetter(getBreakpointFromWorkspace)
			.setFilter(filterOneTime)
			.Use();
	});

	context.subscriptions.push();
}

export function deactivate() {}
