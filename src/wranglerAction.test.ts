import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	execCommands,
	installVarlockWrangler,
	main,
	wranglerCommands,
} from "./wranglerAction";
import { getTestConfig } from "./test/test-utils";

vi.mock("./exec", async () => {
	const actual = await vi.importActual<typeof import("./exec")>("./exec");
	return {
		...actual,
		exec: vi.fn(async () => 0),
		execShell: vi.fn(async () => 0),
	};
});

const testPackageManager = {
	install: "npm i",
	exec: "npx",
	execNoInstall: "npx --no-install",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("installVarlockWrangler", () => {
	it("installs varlock-wrangler and its peer dependencies", async () => {
		const testConfig = getTestConfig({
			config: {
				VARLOCK_VERSION: "1.6.0",
				VARLOCK_CLOUDFLARE_INTEGRATION_VERSION: "1.1.6",
				WRANGLER_VERSION: "4",
			},
		});

		const { exec } = await import("./exec");

		await installVarlockWrangler(testConfig, testPackageManager);

		expect(exec).toHaveBeenCalledWith(
			"npm i",
			["@varlock/cloudflare-integration@1.1.6", "varlock@1.6.0", "wrangler@4"],
			{
				cwd: "/src/test/fixtures",
				silent: false,
			},
		);
	});

	it("skips installing varlock-wrangler and its peer dependencies", async () => {
		const testConfig = getTestConfig({
			config: {
				SKIP_INSTALL: true,
			},
		});

		const { exec } = await import("./exec");

		await installVarlockWrangler(testConfig, testPackageManager);

		expect(exec).not.toHaveBeenCalled();
	});
});

describe("execCommands", () => {
	it("runs wrangler-prefixed pre/post commands through varlock-wrangler", async () => {
		const { execShell } = await import("./exec");
		const testConfig = getTestConfig();

		await execCommands(
			testConfig,
			testPackageManager,
			["wrangler whoami", "echo done"],
			"pre",
		);

		expect(execShell).toHaveBeenNthCalledWith(
			1,
			"npx varlock-wrangler whoami",
			{
				cwd: "/src/test/fixtures",
				silent: false,
			},
		);
		expect(execShell).toHaveBeenNthCalledWith(2, "echo done", {
			cwd: "/src/test/fixtures",
			silent: false,
		});
	});
});

describe("wranglerCommands", () => {
	it("defaults to varlock-wrangler deploy", async () => {
		const testConfig = getTestConfig({
			config: {
				ENVIRONMENT: "",
				COMMANDS: [],
			},
		});

		vi.spyOn(core, "setOutput");
		const { exec } = await import("./exec");

		await wranglerCommands(testConfig, testPackageManager);

		expect(exec).toHaveBeenCalledWith(
			"npx varlock-wrangler deploy",
			[],
			expect.objectContaining({
				cwd: "/src/test/fixtures",
				silent: false,
			}),
		);
	});

	it("adds --env when an environment is configured", async () => {
		const testConfig = getTestConfig({
			config: {
				ENVIRONMENT: "production",
				COMMANDS: ["versions upload"],
			},
		});

		const { exec } = await import("./exec");

		await wranglerCommands(testConfig, testPackageManager);

		expect(exec).toHaveBeenCalledWith(
			"npx varlock-wrangler versions upload",
			["--env", "production"],
			expect.objectContaining({
				cwd: "/src/test/fixtures",
				silent: false,
			}),
		);
	});
});

describe("main", () => {
	it("installs and runs without manual secret or var uploads", async () => {
		const testConfig = getTestConfig({
			config: {
				COMMANDS: ["deploy"],
			},
		});

		vi.spyOn(core, "getMultilineInput").mockReturnValue([]);
		const { exec } = await import("./exec");
		const setFailedSpy = vi.spyOn(core, "setFailed");

		await main(testConfig, testPackageManager);

		expect(exec).toHaveBeenCalledWith(
			"npm i",
			[
				"@varlock/cloudflare-integration@latest",
				"varlock@latest",
				"wrangler@4.72.0",
			],
			expect.any(Object),
		);
		expect(exec).toHaveBeenCalledWith(
			"npx varlock-wrangler deploy",
			["--env", "dev"],
			expect.any(Object),
		);
		expect(setFailedSpy).not.toHaveBeenCalled();
	});
});
