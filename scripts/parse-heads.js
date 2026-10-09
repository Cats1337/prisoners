import { readFile, writeFile } from "node:fs/promises";

const categories = [
    { name: "Circle", file: "circle.txt" },
    { name: "Triangle", file: "triangle.txt" },
    { name: "Square", file: "square.txt" },
    { name: "Cylinder", file: "cylinder.txt" },
    { name: "Star", file: "star.txt" },
];

const heads = [];

for (const category of categories) {
    const markup = await readFile(`scripts/${category.file}`, "utf8");
    const rows = markup.split("|-");
    const categoryHeads = [];

    for (const row of rows) {
        const cells = row
            .split("\n")
            .filter(line => line.trim().startsWith("|"))
            .map(line => line.trim().slice(1).trim());

        if (cells.length < 3) continue;

        const name = cells[1];
        const description = cells[2];

        if (
            !name ||
            name.startsWith("[[") ||
            ["Name", "Picture", "Description"].includes(name)
        ) {
            continue;
        }

        categoryHeads.push({
            name,
            category: category.name,
            description
        });
    }

    // if (categoryHeads.length !== 64) {
    //     throw new Error(
    //         `${category.name}: expected 64 heads, found ${categoryHeads.length}`
    //     );
    // }

    heads.push(...categoryHeads);
    console.log(`${category.name}: ${categoryHeads.length} heads`);
}

await writeFile(
    "heads.json",
    JSON.stringify(heads, null, 2) + "\n"
);

console.log(`Saved ${heads.length} heads to heads.json`);