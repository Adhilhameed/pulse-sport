# PulseSport — Sports E-Commerce Website

A full-stack sports e-commerce website built with Node.js + Express backend and vanilla HTML/CSS/JS frontend. Ready for live deployment and third-party script integration.

## Quick Start

```bash
npm install
npm start
```

Server runs at **http://localhost:3000**

## Project Structure

```
privacy-sports-store/
├── server.js              # Express backend (API + static file server)
├── package.json
├── public/
│   ├── index.html         # Main storefront page
│   ├── css/
│   │   └── styles.css     # Complete styling
│   └── js/
│       └── app.js         # Frontend store logic
```

## Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List products (supports `?category=`, `?search=`, `?sort=`, `?minPrice=`, `?maxPrice=`) |
| GET | `/api/products/:id` | Product detail + related products |
| GET | `/api/categories` | List all categories with counts |
| GET | `/api/cart` | Get current cart with totals |
| POST | `/api/cart/add` | Add item to cart |
| PUT | `/api/cart/update` | Update cart item quantity |
| DELETE | `/api/cart/remove` | Remove item from cart |
| POST | `/api/checkout` | Place an order |
| GET | `/api/orders` | List user's orders |
| GET | `/api/user/profile` | Get user profile |
| PUT | `/api/user/profile` | Update user profile |
| POST | `/api/user/wishlist/toggle` | Toggle wishlist item |
| POST | `/api/newsletter/subscribe` | Subscribe to newsletter |
| GET | `/api/search/suggestions` | Live search suggestions |

## Integrating Scripts

Add your CMP / analytics / tracking scripts in `public/index.html` at the marked section at the bottom of the `<body>` tag, or in the `<head>` tag for scripts that need to load early.

## Deployment

This is a standard Node.js app. Deploy to any platform:

- **Railway / Render / Fly.io**: Push the folder and set start command to `npm start`
- **VPS**: Upload folder, run `npm install && npm start`
- **Docker**: Create a Dockerfile with `node:18-alpine` base

The app uses `process.env.PORT` so it automatically picks up the port assigned by hosting platforms.
