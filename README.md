# BIP47 Terminal

A web-based terminal for BIP47 Auth47 authentication protocol. This application allows users to authenticate their BIP47 payment codes using QR codes and wallet signatures.

## Features

- 🖥️ Terminal-style web interface
- 🔐 BIP47 Auth47 protocol implementation
- 📱 QR code generation for wallet scanning
- ⚡ Real-time authentication status
- 🚀 Ready for Railway deployment

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser:
```
http://localhost:3000
```

### Railway Deployment

#### Prerequisites
- Railway account
- Railway CLI installed (`npm install -g @railway/cli`)
- Git repository

#### Deployment Steps

1. **Login to Railway:**
```bash
railway login
```

2. **Initialize Railway project:**
```bash
railway init
```

3. **Set environment variables:**
```bash
# Set your callback URL (Railway will provide this after first deploy)
railway variables set CALLBACK_URL=https://your-app-name.railway.app/callback

# Set production environment
railway variables set NODE_ENV=production
```

4. **Deploy:**
```bash
railway up
```

5. **Get your Railway URL:**
```bash
railway domain
```

6. **Update CALLBACK_URL** with your actual Railway URL:
```bash
railway variables set CALLBACK_URL=https://your-actual-app-name.railway.app/callback
railway up
```

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | 3000 | No (Railway sets this) |
| `CALLBACK_URL` | Auth47 callback URL | `http://localhost:3000/callback` | Yes (for production) |
| `NODE_ENV` | Environment | development | No |

## How It Works

1. **Generate Challenge**: Click "Generate Auth QR Code" to create a new authentication challenge
2. **Scan with Wallet**: Use Samourai Wallet or compatible BIP47 wallet to scan the QR code
3. **Automatic Verification**: The app polls for verification status and displays results
4. **View Results**: See the verified payment code and authentication status

## API Endpoints

- `GET /` - Frontend interface
- `GET /start-auth` - Generate new authentication challenge
- `GET /check-auth/:nonce` - Check authentication status (polling)
- `POST /verify` - Verify wallet signature (called by wallet)
- `GET /callback` - Callback page for wallet redirect
- `GET /health` - Health check endpoint

## Project Structure

```
bip47-terminal/
├── public/
│   ├── index.html          # Main frontend interface
│   └── callback.html       # Wallet callback page
├── server.js               # Express server with BIP47 logic
├── package.json            # Dependencies and scripts
├── railway.json           # Railway deployment configuration
└── README.md              # This file
```

## Requirements

Node 24 or later (`@dojo-tools/*` declares `engines: >=24`; `.nvmrc` pins it).

## Dependencies

- **express** - Web server framework
- **cors** - Cross-origin resource sharing
- **@bitcoinerlab/secp256k1** - Bitcoin cryptography
- **@dojo-tools/bip47** - BIP47 payment code implementation
- **@dojo-tools/auth47** - Auth47 protocol utilities
- **qrcode** - QR code generation

## Security Notes

- Authentication challenges expire after 5 minutes
- Each nonce can only be used once
- Signatures are verified using BIP47 notification keys
- All sensitive operations are server-side

## Troubleshooting

### Common Issues

1. **"Invalid or expired nonce"**
   - The QR code may have expired (5-minute timeout)
   - Try generating a new QR code

2. **"Invalid signature"**
   - Ensure you're using a compatible BIP47 wallet
   - Check that the wallet supports Auth47 protocol

3. **Deployment issues**
   - Verify CALLBACK_URL is set correctly in Railway
   - Check Railway logs for errors

### Railway Debugging

```bash
# View logs
railway logs

# Check environment variables
railway variables list

# Restart service
railway restart
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Deploy to Railway for testing
6. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues with:
- **BIP47 Protocol**: Check [Samourai Wallet documentation](https://freesamourai.com/)
- **Railway Deployment**: See [Railway docs](https://docs.railway.app/)
- **This Application**: Create an issue in the repository
