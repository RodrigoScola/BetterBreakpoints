import assert from 'assert';
import * as vscode from 'vscode';
import { MyBreakpoint, oneTimeMessage } from './breakpoint';
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
import { Dependency, IgnoreFilesProvider } from './ignoreFiles/provider';
import { state } from './State';
import micromatch from 'micromatch';

function makeName(str: string): string {
	return `betterbreakpoints.${str}`;
}

function getCurrentPath() {
	return (
		vscode.workspace.workspaceFolders?.at(0)?.uri.path ??
		vscode.workspace.workspaceFile?.path ??
		vscode.window.activeTextEditor?.document.uri.path
	);
}

async function logPoints() {
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

async function goTobreakpoint(points: MyBreakpoint[]) {
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

function addConditionalBreakpointsOnFile(doc: vscode.TextDocument, regex: RegExp) {
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

export function activate(context: vscode.ExtensionContext) {
	state.init();

	console.log(
		micromatch.contains(
			'/c:/Users/hando/AppData/Local/Programs/Microsoft VS Code/resources/app/out/vs/workbench/api/node/extensionHostProcess.js',
			'c:/Users/hando/'
		)
	);

	state.onStop = async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const current = vscode.Uri.file(state.getCurrentPath() ?? '');
		const filePath = vscode.Uri.file(editor.document.uri.path);

		const ignoreRegex = state.configuration().IgnoreBreakpointList();

		let path = filePath.path.replace(current.path, '');

		if (path.startsWith('/')) {
			path = path.slice(1);
		}

		if (state.match(path, ignoreRegex)) {
			await vscode.commands.executeCommand('workbench.action.debug.continue').then((f) => {
				state.debuggerStopped = false;
			});
		}
	};

	function addCommand(name: string, fn: (...args: any[]) => void): void {
		context.subscriptions.push(vscode.commands.registerCommand(name, fn));
	}

	vscode.window.registerTreeDataProvider('ignoreFiles', state.provider);

	vscode.window.createTreeView('ignoreFiles', {
		treeDataProvider: state.provider,
	});

	addCommand(makeName('addIgnoreFile'), async () => {
		const input = await vscode.window.showInputBox({
			title: 'Ignore File',
			//todo make a better message
			placeHolder: 'What do you want to ignore? you can put regex',
		});

		if (!input || state.dependencies.some((d) => d.label === input)) {
			return;
		}

		state.dependencies.push(Dependency.New(input));

		await state.save();
	});

	addCommand(makeName('editIgnoreFile'), async (dep: Dependency) => {
		const input = await vscode.window.showInputBox({
			title: 'Ignore File',
			value: dep.label,
			//todo make a better message
			placeHolder: 'What do you want to ignore? you can put regex',
		});

		if (!input) {
			return;
		}

		let ind = -1;
		for (let i = 0; i < state.dependencies.length; i++) {
			if (state.dependencies[i].label === dep.label) {
				ind = i;
			}
		}

		state.dependencies[ind] = Dependency.New(input);

		await state.save();
	});
	addCommand(makeName('deleteIgnoreFile'), async (dep: Dependency) => {
		state.dependencies = state.dependencies.filter((d) => dep.label !== d.label);
		await state.save();
	});

	vscode.debug.registerDebugAdapterTrackerFactory('*', {
		createDebugAdapterTracker(session) {
			state.session = session;
			return {
				onDidSendMessage: async (message) => {
					if (message.command === 'continue') {
						state.debuggerStopped = false;
					}
					if (message.event === 'stopped') {
						state.debuggerStopped = true;

						state.onStop();

						if (message.body.reason === 'breakpoint') {
							state.debuggerStopped = true;

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
}

export function deactivate() {}
