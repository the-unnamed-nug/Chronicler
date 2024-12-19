import express, { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import winston from "winston";

dotenv.config();

const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
const port = 8080;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  throw new Error(
    "Missing GitHub OAuth client credentials in environment variables.",
  );
}

// TODO: Once the application is deployed on a real production server, this
// needs to be changed to a valid URI for callbacks to work. Until this is
// set to a production server, the logger will not function.
const redirectURI = `http://localhost:${port}/callback`;

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

app.get("/login", (req: Request, res: Response) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectURI}&scope=repo,admin:org,read:org`;
  logger.info("Redirecting to GitHub for authorization");
  res.redirect(githubAuthUrl);
});

app.get("/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send("No code provided");
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
        headers: {
          Accept: "application/json",
        },
        timeout: 5000, // request timeout
      },
    );

    const accessToken = response.data.access_token;
    if (!accessToken) {
      return res.status(400).send("No access token received");
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

app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
});
