import express from "express";
import path from "path";
import fs from "fs";
import { router } from "./routes";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((_req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/api", router);

const port = Number(process.env.PORT) || 5000;

async function start() {
  if (process.env.NODE_ENV === "production") {
    const dist = path.resolve(process.cwd(), "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true, hmr: { server: undefined } },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.get("*", async (req, res, next) => {
      try {
        const template = fs.readFileSync(
          path.resolve(process.cwd(), "client/index.html"),
          "utf-8"
        );
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        next(e);
      }
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Cisco N9K Assistant serving on port ${port}`);
  });
}

start();
