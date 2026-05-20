# Weighbridge Management System

A production-oriented weighbridge foundation using React, TypeScript, Tailwind CSS, Express, and a PostgreSQL-ready Prisma schema.

## Run

```powershell
npm install
npm run build
npm start
```

Open:

```text
http://127.0.0.1:4175
```

Default login:

```text
Username: admin
Password: Admin123!
```

## Included

- Operator login and session handling
- Role-based access control
- Live digital indicator endpoint
- Single product transaction workflow
- Multiple product transaction workflow
- Product-wise weighing before final weigh
- Automatic ticket numbers
- Net weight calculation
- Printable ticket slip
- Dashboard metrics
- Vehicle, driver, customer/supplier, and product masters
- Camera capture references for first and final weigh
- Reports with CSV/Excel/PDF export endpoints
- Audit logs and reprint logging
- Site and bridge settings
- Development JSON persistence in `data/runtime-db.json`

## Architecture

- `frontend/`: React + TypeScript + Tailwind CSS
- `backend/`: Node.js + Express API
- `device-service/`: local serial/TCP scale service boundary
- `database/schema.prisma`: PostgreSQL Prisma schema

## Hardware Integration

The backend reads live weight through `/api/device/live-weight`. It can call the local device service with:

```text
DEVICE_SERVICE_URL=http://127.0.0.1:4180
```

The device service currently supports a simulator and TCP skeleton. Serial COM support should be wired with the `serialport` package on the machine connected to the weighbridge indicator.

## Database

The Prisma schema is PostgreSQL-ready. Set `DATABASE_URL`, then run:

```powershell
npm run prisma:generate
```

The current Express API still uses a local development repository so the app can run before PostgreSQL is installed.
