import axios, { AxiosError } from 'axios';
import { parse as parseCSV } from 'csv-parse';
import fastCsv from 'fast-csv';
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

type ModuleType = typeof import('neat-csv');

function loadNeatCsv(): Promise<ModuleType> {
  return import('neat-csv');
}

function readCsv(path: string, options: any, rowProcessor: any) {
  return new Promise((resolve, reject) => {
    const data: any[] = [];

    fastCsv
      .parseFile(path, options)
      .on('error', reject)
      .on('data', (row: any) => {
        const obj = rowProcessor(row);
        if (obj) data.push(obj);
      })
      .on('end', () => {
        resolve(data);
      });
  });
}

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

async function main() {
  options.headers.Authorization = `Basic ${authToken}`;
  const data = await processFile();
  const [headers, ...records] = data;
  const paymentTokenIndex = headers.findIndex((v: string) => v === 'payment_token');
  const tokens = records.map((values: string[]) => values[paymentTokenIndex]);
  const tokenChunks: string[][] = array_chunks(tokens, chunkSize);

  options.data.tokens = [];

  let failures = [];

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
  failures = failures.flat();
  fs.writeFileSync(csvPath + '.failures', JSON.stringify(failures));
}

main();
