import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const r = await d.list();
console.log('typeof:', typeof r, 'isArray:', Array.isArray(r));
console.log('keys:', r && typeof r === 'object' ? Object.keys(r).slice(0,20) : r);
console.log('Daytona methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(d)));
console.log('snapshot methods:', d.snapshot ? Object.getOwnPropertyNames(Object.getPrototypeOf(d.snapshot)) : 'none');
