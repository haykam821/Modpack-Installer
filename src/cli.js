const yargs = require("yargs");
const chalk = require("chalk");
const got = require("got");
const fs = require("fs-extra");
const path = require("path");
const nbt = require("prismarine-nbt");

const types = {
	critical: ["", chalk.red, true],
	darn: ["", chalk.redBright],
	info: ["", chalk.blue],
	yay: ["", chalk.green],
};


function log(typeName, msg) {
	const type = types[typeName] || types.darn;
	process.stdout.write(`${type[1].bold(type[0])} ${type[1](msg)}\n`);

	if (type[2]) {
		process.exit(0);
	}

	return type;
}

function getModUrl(mod) {
	switch (mod.type) {
		case "forge":
			return `https://minecraft.curseforge.com/projects/${mod.projectID}/files/${mod.fileID}/download`;
		default:
			return mod.url;
	}
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
}, async argv => {
	const config = await fs.readJSON(argv.config).catch(() => {
		log("critical", "Could not read the modpack config file.");
	});

	if (config.pack && config.pack.name) {
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

	fs.ensureDir(path.join(argv.folder, "./mods/"));

	for await (const mod of config.mods) {
		const jar = await got(getModUrl(mod)).catch(() => {
			log("critical", "Could not fetch a mod.");
		});

		const paths = jar.request.gotOptions.pathname.split("/");
		const filename = paths[paths.length - 1];

		await fs.writeFile(path.join(argv.folder, "./mods/", filename), jar.body);
		log("info", `Downloaded ${filename}.`);
	}

	log("info", "Finished!");
});

yargs.argv;