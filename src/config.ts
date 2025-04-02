import assert from 'assert';
import * as vscode from 'vscode';
import { WorkspaceConfiguration } from 'vscode';

export class Config {
	private config: WorkspaceConfiguration;
	constructor(configuration: WorkspaceConfiguration) {
		this.config = configuration;
	}

	IgnoreBreakpointList(): string[] {
		try {
			assert(this.config, ' config has not been setup');
		} catch (err) {}

		const value = this.config.get('ignoredFiles', []);

		try {
			assert(typeof value !== 'undefined' && value !== null, 'value was not found');
		} catch (err) {}

		return value;
	}
	public async updatePatterns(patterns: string[], target: vscode.ConfigurationTarget) {
		return this.config.update('ignoredFiles', patterns, target);
	}
}
