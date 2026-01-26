# opsAi

WhatsApp-based operations management system for convenience stores. Automatically ingests operational data (text + images) via WhatsApp, classifies and extracts structured data, and writes to per-store Google Sheets.

## Features

- 📱 **WhatsApp Integration**: Receive messages and images from store staff
- 🏪 **Multi-Store Support**: Auto-detect store from phone number or message prefix
- 🤖 **AI Classification**: Classify messages into 5 types (Sales, Fuel, Invoice, Paid-Out, Order)
- 🔍 **OCR + AI Extraction**: Extract structured data from text and images
- ✅ **Confirmation Flow**: WhatsApp bot replies with OK/FIX/CANCEL commands
- 📊 **Google Sheets Integration**: Write structured data to per-store sheets
- 📋 **Review Queue**: Handle low-confidence extractions

## Tech Stack

- **Backend**: Node.js + TypeScript + Express.js
- **Database**: PostgreSQL + Prisma ORM
- **WhatsApp**: Meta WhatsApp Business Cloud API
- **Storage**: AWS S3 (for images)
- **OCR**: Google Cloud Vision API
- **AI**: OpenAI GPT-4 Vision
- **Queue**: BullMQ + Redis
- **Sheets**: Google Sheets API v4

## Prerequisites

- Node.js 18+ or 20+ LTS
- PostgreSQL database
- Redis (for job queue)
- WhatsApp Business API account
- Google Cloud account (for Vision API & Sheets API)
- AWS account (for S3)
- OpenAI API key

## Setup

1. **Clone and install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Set up database**
   ```bash
   # Generate Prisma client
   npm run prisma:generate
   
   # Run migrations
   npm run prisma:migrate
   ```

4. **Start Redis** (required for job queue)
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine
   
   # Or install locally
   redis-server
   ```

5. **Run development server**
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for all required environment variables. Key ones:

- `DATABASE_URL`: PostgreSQL connection string
- `WHATSAPP_ACCESS_TOKEN`: WhatsApp Business API token
- `GOOGLE_VISION_API_KEY`: For OCR
- `OPENAI_API_KEY`: For AI classification/extraction
- `REDIS_URL`: Redis connection string
- `AWS_S3_BUCKET_NAME`: S3 bucket for image storage

## Project Structure

```
src/
├── controllers/     # Request handlers
├── services/        # Business logic
├── routes/          # Express routes
├── middleware/      # Express middleware
├── types/           # TypeScript types
├── utils/           # Utilities (logger, etc.)
└── index.ts         # Entry point
```

## Development

- `npm run dev` - Start dev server with hot reload
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run prisma:studio` - Open Prisma Studio (database GUI)

## MVP Milestones

1. ✅ Project setup & structure
2. ⏳ WhatsApp webhook + verification + inbound logging
3. ⏳ User/store mapping + STORE linking flow
4. ⏳ Order flow (text only) + reply-back + write Orders tabs
5. ⏳ Add image OCR extraction for orders
6. ⏳ Add invoices flow
7. ⏳ Add store sales flow
8. ⏳ Add paid-out and fuel flows
9. ⏳ Add STATUS/TODAY/MONTH commands
10. ⏳ Vendor send command (SEND HLA)

## License

ISC
