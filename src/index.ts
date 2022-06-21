import { parse } from "ts-command-line-args";
import axios, { AxiosError } from "axios";
interface ICopyFilesArguments {
  tokens: string[];
  authToken: string;
  help?: boolean;
}

export const { tokens: rawTokens, authToken } = parse<ICopyFilesArguments>(
  {
    tokens: {
      type: String,
      multiple: true,
      description: "List of tokens",
    },
    authToken: {
      type: String,
      description: "Auth token",
    },

    help: {
      type: Boolean,
      optional: true,
      alias: "h",
      description: "Prints this usage guide",
    },
  },
  {
    helpArg: "help",
    headerContentSections: [
      {
        header: "API Call Runner",
        content: "https://monatglobal.com",
      },
    ],
  }
);

const tokens = rawTokens.map((token) => token.split(",")).flat();

var options = {
  method: "POST",
  url: "https://api.nexiopaysandbox.com/pay/v3/deleteToken",
  headers: { "Content-Type": "application/json", Authorization: "Basic " },
  data: { tokens: [""] },
};

async function main() {
  options.headers.Authorization = `Basic ${authToken}`;
  options.data.tokens = tokens;

  console.info("API Call Options:", options);
  try {
    const { data } = await axios.request(options);
    console.info("Response", data);
  } catch (err) {
    const errors = err as Error | AxiosError;
    if (!axios.isAxiosError(err)) {
      console.log(errors.message);
    } else {
      //@ts-ignore
      const { status, statusText, data } = errors.response;
      console.log("FAILURE", { status, statusText, data });
    }
  }
}

main();
