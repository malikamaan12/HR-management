import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
if(existsSync('.env'))loadEnvFile('.env');
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
const {DATABASE_URL,BOOTSTRAP_ADMIN_EMAIL,BOOTSTRAP_ADMIN_USERNAME,BOOTSTRAP_ADMIN_PASSWORD}=process.env;
if(!DATABASE_URL || !BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_USERNAME || !BOOTSTRAP_ADMIN_PASSWORD)throw new Error('Set DATABASE_URL and BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD in the server environment');
if(!/^\S+@\S+\.\S+$/.test(BOOTSTRAP_ADMIN_EMAIL)||BOOTSTRAP_ADMIN_USERNAME.length<3||BOOTSTRAP_ADMIN_PASSWORD.length<12||Buffer.byteLength(BOOTSTRAP_ADMIN_PASSWORD)>72)throw new Error('Use a valid email, username of 3+ characters and password of 12–72 bytes');
const pool=new Pool({connectionString:DATABASE_URL});const client=await pool.connect();
try{
 await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(7391451)");
 const existing=await client.query("SELECT id FROM users WHERE role IN ('admin','super_admin') LIMIT 1");
 if(existing.rowCount)throw new Error('An administrator already exists. Use User management to create additional accounts.');
 const password=await bcrypt.hash(BOOTSTRAP_ADMIN_PASSWORD,12);
 await client.query("INSERT INTO users (username,email,password,first_name,last_name,role,is_active,approval_status) VALUES ($1,$2,$3,$4,$5,'super_admin',true,'approved')",[BOOTSTRAP_ADMIN_USERNAME,BOOTSTRAP_ADMIN_EMAIL,password,'System','Administrator']);
 await client.query('COMMIT');console.log('Initial administrator created. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment after setup.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
