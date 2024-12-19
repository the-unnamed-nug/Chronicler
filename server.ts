import express, { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import winston from "winston";
import bodyParser from "body-parser";

dotenv.config();

const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, BASE_URL } = process.env;
const port = 8080;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  throw new Error(
    "Missing GitHub OAuth client credentials in environment variables.",
  );
}

const redirectURI = `${BASE_URL || `http://localhost:${port}`}/callback`;

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`,
    ),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "activity_log.log" }),
  ],
});

const app = express();
app.use(express.json());
app.use(bodyParser.json());

app.get("/login", (_, res: Response) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectURI}&scope=repo,admin:org,read:org`;
  logger.info("Redirecting to GitHub for authorization");
  res.redirect(githubAuthUrl);
});

app.get("/callback", async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("No code provided");
    return;
  }

  try {
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      null,
      {
        params: {
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectURI,
        },
        headers: { Accept: "application/json" },
        timeout: 5000, // request timeout
      },
    );

    const accessToken = response.data.access_token;
    if (!accessToken) {
      res.status(400).send("No access token received");
      return;
    }

    logger.info("OAuth authorization successful");

    const octokit = new Octokit({ auth: accessToken });
    const user = await octokit.rest.users.getAuthenticated();
    logger.info(`Authenticated as ${user.data.login}`);

    const repos = await octokit.rest.repos.listForAuthenticatedUser();
    logger.info(`Repositories: ${repos.data.length}`);
    repos.data.forEach((repo) => {
      logger.info(`Repo: ${repo.full_name} - ${repo.description}`);
    });

    res.send("OAuth Flow Complete!");
  } catch (error: unknown) {
    if (error instanceof AxiosError) {
      logger.error(`Error during OAuth flow: ${error.message}`);
    } else if (error instanceof Error) {
      logger.error(`Unexpected error: ${error.message}`);
    }
    res.status(500).send("Something went wrong");
  }
});

app.post("/webhook", (req: Request, res: Response): void => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  if (!event) {
    logger.warn("Received webhook with no event type");
    res.status(400).send("Missing GitHub event type");
    return;
  }

  logger.info(`Received GitHub event: ${event}`);
  logger.info(`Event payload: ${JSON.stringify(payload, null, 2)}`);

  switch (event) {
    case "push":
      logger.info(
        `Push event: ${payload.ref} - ${payload.repository.full_name}`,
      );
      break;
    case "issues":
      logger.info(
        `Issue event: ${payload.issue.title} - ${payload.repository.full_name}`,
      );
      break;
    case "member":
      logger.info(
        `New member added: ${payload.member.login} to ${payload.organization.login}`,
      );
      break;
    case "repository":
      logger.info(
        `Repository event: ${payload.repository.full_name} - Action: ${payload.action}`,
      );
      break;
    case "organization":
      logger.info(
        `Organization event: ${payload.organization.login} - Action: ${payload.action}`,
      );
      break;
    default:
      logger.info(`Unhandled event type: ${event}`);
  }

  res.status(200).send("Webhook received successfully");
});

app.listen(port, () => {
  logger.info(`Server running at ${BASE_URL || `http://localhost:${port}`}`);
});
