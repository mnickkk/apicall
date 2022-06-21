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
  url: 'https://api.nexiopay.com/pay/v3/deleteToken',
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
let completed: string[][] = [];

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
      console.log('Making api call with', options);
      const { data } = await axios.request<
        {
          status: 'success' | 'failure';
          key: string;
          message: string;
        }[]
      >(options);
      const completedChunk = data.filter(chunk => chunk.status === 'success').map(chunk => chunk.key);
      completed.push(completedChunk);
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
  console.log(`Exitting, writing dat to disk`);

  const failedRows = failures.flat().map(value => ({ payment_token: value }));
  const completedRows = completed.flat().map(value => ({ payment_token: value }));
  console.log({ failedRows, completedRows });

  const failedCSV = new ObjectsToCsv(failedRows);
  await failedCSV.toDisk(csvPath + '.failures');
  const completedCSV = new ObjectsToCsv(completedRows);
  await completedCSV.toDisk(csvPath + '.completions');
}

main();
