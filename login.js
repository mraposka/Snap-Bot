/**
 * CLI: tek bir hesabı bir kez çalıştırır. Asıl mantık bot.js içindedir.
 * (XPath / metin ayarları da bot.js'te.)
 *
 * Kullanım:
 *   node login.js --user=kullanici --pass=sifre
 *   node login.js -u kullanici -p sifre --headless --accepts 500
 *   node login.js kullanici sifre
 * CLI verilmezse .env'deki SNAP_USERNAME / SNAP_PASSWORD kullanılır.
 */

require("dotenv").config();
const { runAccount } = require("./bot");

function parseArgs(argv) {
  const out = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out.flags[k] =
        v === undefined ? (argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true) : v;
    } else if (a.startsWith("-")) {
      const k = a.slice(1);
      out.flags[k] = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const username =
  args.flags.user || args.flags.u || args.positional[0] || process.env.SNAP_USERNAME;
const password =
  args.flags.pass || args.flags.p || args.positional[1] || process.env.SNAP_PASSWORD;
const headless =
  args.flags.headless === true || args.flags.headless === "true"
    ? true
    : args.flags.headless === "false"
    ? false
    : process.env.HEADLESS === "true";
const maxAccepts = parseInt(args.flags.accepts || args.flags.max || "0", 10) || 0;

(async () => {
  console.log(`» Hesap: ${username}  (headless=${headless}, accepts=${maxAccepts || "sınırsız"})`);
  const res = await runAccount({
    username,
    password,
    headless,
    maxAccepts,
    keepOpen: true, // CLI'da tarayıcıyı açık bırak (captcha vb. için)
    log: (line) => console.log("  " + line),
    onAccept: (n) => process.stdout.write(`\r  Kabul edilen: ${n}   `),
  });
  console.log("\n--- Sonuç ---");
  console.log(res);
})();
