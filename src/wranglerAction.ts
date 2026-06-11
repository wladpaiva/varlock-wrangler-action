import {
	getMultilineInput,
	endGroup as originalEndGroup,
	startGroup as originalStartGroup,
	setFailed,
	setOutput,
} from "@actions/core";
import { z } from "zod";
import { exec, execShell } from "./exec";
import { PackageManager } from "./packageManagers";
import { error, info } from "./utils";
import { handleCommandOutputParsing } from "./commandOutputParsing";

export type WranglerActionConfig = z.infer<typeof wranglerActionConfig>;
export const wranglerActionConfig = z.object({
	WRANGLER_VERSION: z.string(),
	VARLOCK_VERSION: z.string(),
	VARLOCK_CLOUDFLARE_INTEGRATION_VERSION: z.string(),
	workingDirectory: z.string(),
	CLOUDFLARE_API_TOKEN: z.string(),
	CLOUDFLARE_ACCOUNT_ID: z.string(),
	ENVIRONMENT: z.string(),
	COMMANDS: z.array(z.string()),
	QUIET_MODE: z.boolean(),
	PACKAGE_MANAGER: z.string(),
	WRANGLER_OUTPUT_DIR: z.string(),
	GITHUB_TOKEN: z.string(),
});

function startGroup(config: WranglerActionConfig, name: string): void {
	if (!config.QUIET_MODE) {
		originalStartGroup(name);
	}
}

function endGroup(config: WranglerActionConfig): void {
	if (!config.QUIET_MODE) {
		originalEndGroup();
	}
}

async function main(
	config: WranglerActionConfig,
	packageManager: PackageManager,
) {
	try {
		wranglerActionConfig.parse(config);
		authenticationSetup(config);
		await installVarlockWrangler(config, packageManager);

		await execCommands(
			config,
			packageManager,
			getMultilineInput("preCommands"),
			"pre",
		);
		await wranglerCommands(config, packageManager);
		await execCommands(
			config,
			packageManager,
			getMultilineInput("postCommands"),
			"post",
		);
		info(config, "🏁 Varlock Wrangler Action completed", true);
	} catch (err: unknown) {
		err instanceof Error && error(config, err.message);
		setFailed("🚨 Action failed");
	}
}

async function installVarlockWrangler(
	config: WranglerActionConfig,
	packageManager: PackageManager,
): Promise<void> {
	startGroup(config, "📥 Installing Varlock Wrangler");
	try {
		await exec(
			packageManager.install,
			[
				`@varlock/cloudflare-integration@${config["VARLOCK_CLOUDFLARE_INTEGRATION_VERSION"]}`,
				`varlock@${config["VARLOCK_VERSION"]}`,
				`wrangler@${config["WRANGLER_VERSION"]}`,
			],
			{
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
			},
		);

		info(config, `✅ Varlock Wrangler installed`, true);
	} finally {
		endGroup(config);
	}
}

function authenticationSetup(config: WranglerActionConfig) {
	process.env.CLOUDFLARE_API_TOKEN = config["CLOUDFLARE_API_TOKEN"];
	process.env.CLOUDFLARE_ACCOUNT_ID = config["CLOUDFLARE_ACCOUNT_ID"];
}

async function execCommands(
	config: WranglerActionConfig,
	packageManager: PackageManager,
	commands: string[],
	cmdType: string,
) {
	if (!commands.length) {
		return;
	}

	startGroup(config, `🚀 Running ${cmdType}Commands`);
	try {
		for (const command of commands) {
			const cmd = command.startsWith("wrangler")
				? `${packageManager.exec} varlock-${command}`
				: command.startsWith("varlock-wrangler")
					? `${packageManager.exec} ${command}`
					: command;

			await execShell(cmd, {
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
			});
		}
	} finally {
		endGroup(config);
	}
}

async function wranglerCommands(
	config: WranglerActionConfig,
	packageManager: PackageManager,
) {
	startGroup(config, "🚀 Running Varlock Wrangler Commands");
	try {
		const commands = config["COMMANDS"];
		const environment = config["ENVIRONMENT"];

		if (!commands.length) {
			commands.push("deploy");
		}

		for (const command of commands) {
			const args = [];

			if (environment && !command.includes("--env")) {
				args.push("--env", environment);
			}

			// Used for saving the wrangler output
			let stdOut = "";
			let stdErr = "";

			// set WRANGLER_OUTPUT_FILE_DIRECTORY env for exec
			process.env.WRANGLER_OUTPUT_FILE_DIRECTORY = config.WRANGLER_OUTPUT_DIR;

			const options = {
				cwd: config["workingDirectory"],
				silent: config["QUIET_MODE"],
				listeners: {
					stdout: (data: Buffer) => {
						stdOut += data.toString();
					},
					stderr: (data: Buffer) => {
						stdErr += data.toString();
					},
				},
			};

			// Execute the varlock-wrangler command
			await exec(
				`${packageManager.exec} varlock-wrangler ${command}`,
				args,
				options,
			);

			// Set the outputs for the command
			setOutput("command-output", stdOut);
			setOutput("command-stderr", stdErr);

			// Handles setting github action outputs and creating github deployment and job summary
			await handleCommandOutputParsing(config, command, stdOut);
		}
	} finally {
		endGroup(config);
	}
}

export {
	authenticationSetup,
	execCommands,
	info,
	installVarlockWrangler,
	main,
	wranglerCommands,
};
