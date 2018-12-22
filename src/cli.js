const yargs = require("yargs");
const chalk = require("chalk");
const got = require("got");
const fs = require("fs-extra");
const path = require("path");
const nbt = require("prismarine-nbt");
const { exec } = require("child_process");

class LogType {
	constructor(prefix, colorer, exit) {
		this.prefix = prefix || "log";
		this.colorer = colorer || chalk.gray;
		this.exit = exit || false;
	}

	format(message) {
		const prefix = this.colorer.bold(this.prefix.toUpperCase() + ":");
		return `${prefix} ${this.colorer(message)}`;
	}
}

/**
 * @type {Object.<LogType>}
 */
const types = {
	critical: new LogType("CRITICAL", chalk.red, true),
	darn: new LogType("   ERROR", chalk.redBright),
	info: new LogType("    INFO", chalk.blue),
	yay: new LogType(" SUCCESS", chalk.green),
};

/**
 * Logs a message to the console.
 * @param {string} typeName The message type.
 * @param {string} msg The message to log.
 * @returns {LogType} The log type that was used for the message.
 */
function log(typeName, msg) {
	const type = types[typeName] || types.darn;
	process.stdout.write(type.format(msg) + "\n");

	if (type.exit) {
		process.exit(0);
	}

	return type;
}

/**
 * Gets the URL from a mod.
 * @param {Object} mod An object representing a mod.
 * @returns {string} The URL to the mod's download.
 */
function getModUrl(mod) {
	switch (mod.type) {
		case "curseforge":
			return `https://minecraft.curseforge.com/projects/${mod.projectID}/files/${mod.fileID}/download`;
		default:
			return mod.url;
	}
}

/**
 * Ensures (or erases) a directory.
 * @param {Object} argv The argv from the CLI.
 * @param  {...string} dirs The directories to join.
 * @returns {Promise}
 */
function ensure(argv, ...dirs) {
	const location = path.join(argv.folder, ...dirs);
	if (argv.clean) {
		return fs.emptyDir(location);
	} else {
		return fs.ensureDir(location);
	}
}

/**
 * Generates a basic config file.
 * @param {Object} obj The object to make into a key-value config.
 * @param {string} header The header of the config.
 * @param {boolean} timestamp If true, includes the generated timestamp in the header.
 * @returns {string}
 */
function keyValConfig(obj = {}, header = "Generated by haykam821's modpack installer", timestamp = true) {
	const keyVal = Object.entries(obj).map(entry => {
		return entry[0] + "=" + entry[1];
	}).join("\n");

	const headerThing = header ? `# ${header}\n` : "";
	const timestampThing = timestamp ? `# ${new Date().toUTCString()}\n` : "";

	return headerThing + timestampThing + keyVal;
}

/**
 * Runs a script if possible.
 * @param {string} name The script to run.
 * @param {Object} config The modpack config.
 * @param {Object} argv The argv from the CLI.
 * @returns {ChildProcess}
 */
function script(name, config, argv) {
	if (argv.ignoreScripts || !config.scripts || !config.scripts[name]) {
		return;
	}

	return exec(config.scripts[name], {
		cwd: process.cwd(),
		env: {
			MODPACK_FOLDER: argv.folder,
		},
	});
}

yargs.command("*", "Installs a modpack using a modpack configuration file.", builder => {
	builder.option("config", {
		alias: "c",
		type: "string",
	});
	builder.option("folder", {
		alias: "f",
		description: "The path to the .minecraft folder.",
	});
	builder.option("clean", {
		default: false,
		description: "Removes all content in folders that will be changed by the installation.",
		type: "boolean",
	});
	builder.option("ignore-scripts", {
		default: false,
		description: "Prevents scripts from being ran.",
		type: "boolean",
	});
}, async argv => {
	await ensure(argv);

	const config = await fs.readJSON(argv.config).catch(() => {
		log("critical", "Could not read the modpack config file.");
	});

	if (!config.pack || !config.pack.format || isNaN(config.pack.format)) {
		log("critical", "This modpack is not in the correct format.");
	}

	script("start", config, argv);
	if (config.pack.name) {
		log("info", `Installing the ${config.pack.name} modpack.`);
	} else {
		log("info", "Installing the modpack.");
	}

	if (config.servers) {
		const servers = config.servers.map(server => ({
			ip: {
				type: "string",
				value: server.ip,
			},
			name: {
				type: "string",
				value: server.name,
			},
		}));
		const serverNbt = nbt.writeUncompressed({
			name: "servers",
			type: "compound",
			value: {
				servers: {
					type: "list",
					value: {
						type: "compound",
						value: servers,
					},
				},
			},
		});

		fs.writeFile(path.join(argv.folder, "./servers.dat"), serverNbt).then(() => {
			log("info", "The server data has been written.");
		});
	}

	await ensure(argv, "./config/");

	// Splash.properties file
	if (config.splash) {
		await fs.writeFile(path.join(argv.folder, "./config/splash.properties"), keyValConfig(config.splash));
		log("info", "Wrote the splash.properties file.");
	}

	// Mod installation
	await ensure(argv, "./mods/");
	for await (const mod of config.mods) {
		const jar = await got(getModUrl(mod), {
			encoding: null,
		}).catch(() => {
			if (mod.name) {
				log("critical", `Could not fetch ${mod.name}.`);
			} else {
				log("critical", "Could not fetch a mod.");
			}
		});

		const paths = jar.request.gotOptions.pathname.split("/");
		const filename = mod.name || paths[paths.length - 1];

		await fs.writeFile(path.join(argv.folder, "./mods/", filename + ".jar"), jar.body);
		log("info", `Downloaded ${filename}.`);
	}

	script("finish", config, argv);
	log("info", "Finished!");
});

yargs.argv;