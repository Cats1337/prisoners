import { readFile, writeFile } from "node:fs/promises";

const heads = JSON.parse(
    await readFile("heads.json", "utf8")
);

const inventory = JSON.parse(
    await readFile("steam-inventory.json", "utf8")
);

const normalize = name =>
    String(name ?? "")
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

const icons = new Map(
    inventory.items.map(item => [
        normalize(item.market_hash_name || item.name),
        item.icon_url
    ])
);

let matched = 0;

for (const head of heads) {
    const icon = icons.get(normalize(head.name));

    head.icon_url = icon || "EMPTY_PATH";

    if (icon) {
        matched++;
    }
}

await writeFile(
    "heads.json",
    JSON.stringify(heads, null, 2) + "\n"
);

console.log(`Matched ${matched} of ${heads.length} heads`);