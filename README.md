# URL Shortener Backend Service

A high-performance URL shortener backend service inspired by Bitly, built using NestJS, PostgreSQL, and Redis.

## 🚀 Features

### Core Functionality
- **Create Short URLs**: Generate unique 7-character short links for any long URL.
- **Redirection**: Fast redirection to original URLs using Redis caching.
- **Click Analytics**: Track detailed usage of shortened URLs, including total clicks and unique visitors.
- **User Dashboard**: Retrieve all previously generated links for a specific `user_id`.

### Bonus Features Implemented
- 🛡️ **Rate Limiting**: Integrated using `@nestjs/throttler` (Global limits + Strict limit on URL creation).
- 🎲 **Collision-Free Generation**: Advanced retry mechanisms utilizing `nanoid` to ensure code uniqueness.
- 🕒 **URL Expiration**: Time-based short code expiration validation at redirection time.
- 👤 **Unique Tracking**: Tracks distinct visitors using IP addresses asynchronously over standard click events.

---

## 🛠️ Technology Stack

- **Framework**: [NestJS](https://nestjs.com/) (TypeScript)
- **Database**: [PostgreSQL](https://www.postgresql.org/) (via TypeORM)
- **Caching**: [Redis](https://redis.io/) (via `ioredis`) for speeding up database reads/redirects.
- **Hosting**: Deployed on [Render](https://render.com/) *(If Applicable)*.

---

## 🏃‍♂️ Local Setup Instructions

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL installed locally or remotely
- Redis server instance

### 2. Installation
Clone the repository and install the dependencies:
```bash
git clone <repository-url>
cd url_shortener
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory and add the following keys. Example:
```env
# PostgreSQL connection string
POSTGRES_DB_URL=postgresql://username:password@hostname:5432/database_name

# Redis connection string
REDIS_URL=redis://username:password@hostname:6379

# The root URL for your application (determines the short_url output base)
BASE_URL="http://localhost:3000"
```

### 4. Running the Application
```bash
# development
npm run start

# watch mode
npm run start:dev

# production mode
npm run start:prod
```
The server will be running normally on `http://localhost:3000`.

---

## 📑 API Documentation

### 1. Create Short URL
Generates a short URL code and stores the mapping.

- **URL:** `POST /shorten`
- **Request Body:**
  ```json
  {
    "original_url": "https://example.com/product/123",
    "user_id": "U123",            // Optional string identifier
    "expires_at": "2026-12-31"    // Optional expiration date
  }
  ```
- **Response:**
  ```json
  {
    "short_url": "http://localhost:3000/aX7kP2x",
    "original_url": "https://example.com/product/123"
  }
  ```

### 2. Redirect URL
Redirects the user to the underlying original link while recording analytics in the background.

- **URL:** `GET /:short_code`
- **Response:** HTTP `302 Found` Redirect to the `original_url`.
- **Note:** Responses are primarily resolved against the Redis Cache for speed.

### 3. Click Analytics
Retrieves click activity for a specific short link.

- **URL:** `GET /analytics/:short_code`
- **Response:**
  ```json
  {
    "short_code": "aX7kP2x",
    "original_url": "https://example.com/product/123",
    "total_clicks": 152,
    "unique_visitors": 45
  }
  ```

### 4. List User URLs
Outputs an aggregated view of all URLs shortened under a specific user tracking ID.

- **URL:** `GET /urls/:user_id`
- **Response:**
  ```json
  {
    "user_id": "U123",
    "urls": [
      {
        "short_code": "aX7kP2x",
        "original_url": "https://example.com/product/123",
        "clicks": 152,
        "created_at": "2026-03-17T04:20:00.000Z"
      }
    ]
  }
  ```

---

## 📐 Database Architecture (PostgreSQL)

**Table: `urls`**
- `id` (UUID, Primary Key)
- `short_code` (VARCHAR 20, Unique Index)
- `original_url` (TEXT)
- `user_id` (VARCHAR 100, Nullable)
- `expires_at` (TIMESTAMP, Nullable)
- `created_at` (TIMESTAMP)

**Table: `clicks`**
- `id` (UUID, Primary Key)
- `short_code` (VARCHAR 20, Index)
- `ip_address` (VARCHAR 45)
- `user_agent` (TEXT, Nullable)
- `created_at` (TIMESTAMP)
