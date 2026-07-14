import express, { type Express } from "express";
import fs from "fs";
import path from "path";

function getBaseUrl(req: express.Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domains) return `https://${domains}`;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "omtpulse.com";
  return `${proto}://${host}`;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Intercept /invite before the static catch-all so WhatsApp / social crawlers
  // receive OG meta tags and render a rich preview card instead of a bare link.
  // Real users get the same index.html — React hydrates normally on the client.
  app.get("/invite", (req, res, next) => {
    const indexPath = path.resolve(distPath, "index.html");
    fs.readFile(indexPath, "utf8", (err, html) => {
      if (err) return next();
      const base = getBaseUrl(req);
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const pageUrl = `${base}/invite?token=${encodeURIComponent(token)}`;
      const ogTags = [
        `<meta property="og:type"        content="website" />`,
        `<meta property="og:url"         content="${pageUrl}" />`,
        `<meta property="og:title"       content="OMT Pulse — Join the team" />`,
        `<meta property="og:description" content="You've been invited to OMT Pulse. Tap to set up your account." />`,
        `<meta property="og:image"       content="${base}/og-invite.jpg" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta name="twitter:card"       content="summary_large_image" />`,
        `<meta name="twitter:title"      content="OMT Pulse — Join the team" />`,
        `<meta name="twitter:description" content="You've been invited to OMT Pulse. Tap to set up your account." />`,
        `<meta name="twitter:image"      content="${base}/og-invite.jpg" />`,
      ].join("\n    ");
      const patched = html.replace("</head>", `    ${ogTags}\n  </head>`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(patched);
    });
  });

  // Public org signup is disabled — send bookmarked /register URLs to login.
  app.get("/register", (_req, res) => {
    res.redirect(302, "/login");
  });

  // Service worker must never be cached by the browser or an old worker sticks forever.
  app.get("/sw.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.sendFile(path.resolve(distPath, "sw.js"));
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
