import axios, { AxiosError } from 'axios';
import { parse as parseCSV } from 'csv-parse';

import ObjectsToCsv from 'objects-to-csv';
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';
import { parse } from 'ts-command-line-args';

interface ICopyFilesArguments {
  csvPath: string;
  authToken: string;
  help?: boolean;
  chunkSize?: number;
  timeMsBetweenRequests?: number;
}

export const {
  csvPath,
  authToken,
  chunkSize = 10,
  timeMsBetweenRequests = 0,
} = parse<ICopyFilesArguments>(
  {
    csvPath: {
      type: String,
      description: 'List of tokens',
    },
    authToken: {
      type: String,
      description: 'Auth token',
    },
    chunkSize: {
      type: Number,
      description: 'Chunk Size',
      optional: true,
    },
    timeMsBetweenRequests: {
      type: Number,
      description: 'Delay between requests',
      optional: true,
    },

    help: {
      type: Boolean,
      optional: true,
      alias: 'h',
      description: 'Prints this usage guide',
    },
  },
  {
    helpArg: 'help',
    headerContentSections: [
      {
        header: 'API Call Runner',
        content: 'https://monatglobal.com',
      },
    ],
  }
);

var options = {
  method: 'POST',
  url: 'https://api.nexiopaysandbox.com/pay/v3/deleteToken',
  headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' },
  data: { tokens: [''] },
};

const array_chunks = (array: any[], chunk_size: number) =>
  Array(Math.ceil(array.length / chunk_size))
    .fill(undefined)
    .map((_, index) => index * chunk_size)
    .map(begin => array.slice(begin, begin + chunk_size));

const processFile = async () => {
  const records: any = [];
  const parser = fs.createReadStream(path.resolve(csvPath)).pipe(
    parseCSV({
      // CSV options if any
      columns: true,
      groupColumnsByName: true,
    })
  );
  parser.on('readable', function () {
    let record;
    while ((record = parser.read()) !== null) {
      // Work with each record
      records.push(record);
    }
  });
  await finished(parser);
  return records;
};
let failures: string[][] = [];

async function main() {
  options.headers.Authorization = `Basic ${authToken}`;
  const records = await processFile();
  const tokens = records.map((values: { payment_token: string }) => values.payment_token);
  const tokenChunks: string[][] = array_chunks(tokens, chunkSize);

  options.data.tokens = [];

  for await (const chunk of tokenChunks) {
    options.data.tokens = chunk;
    await new Promise(r => setTimeout(r, timeMsBetweenRequests));

    try {
      const { data } = await axios.request(options);
      console.info('Response', data);
    } catch (err) {
      const errors = err as Error | AxiosError;
      if (!axios.isAxiosError(err)) {
        console.log(errors.message);
      } else {
        //@ts-ignore
        const { status, statusText, data } = errors.response;
        console.log('FAILURE', { status, statusText, data });
        failures.push(chunk);
      }
    }
  }
}

main();

async function exitHandler(options: any, exitCode: number) {
  const rows = failures.flat().map(value => ({ payment_token: value }));
  console.log(`Exitting, writting failures to disk`, rows);
  const csv = new ObjectsToCsv(rows);
  await csv.toDisk(csvPath + '.failures');
  if (options.exit) process.exit();
}

process.on('exit', exitHandler.bind(null, { exit: true }));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, { exit: true }));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
