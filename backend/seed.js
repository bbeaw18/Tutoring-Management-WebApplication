const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();

const User = require('./models/User');

async function seedDatabase() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not found in .env file');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: 'b.beaw18@gmail.com' });
    if (existingAdmin) {
      console.log('Admin user already exists. Skipping seed.');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('Creating admin user...');

    // Generate TOTP secret for admin
    const secret = speakeasy.generateSecret({
      name: 'KMS (b.beaw18@gmail.com)',
      issuer: 'Knowledge Management System'
    });

    // Create admin user
    const adminUser = new User({
      firstName: 'Admin',
      lastName: 'KMS',
      email: 'b.beaw18@gmail.com',
      password: 'KoonBeaw002!',
      phone: '0000000000',
      role: 'admin',
      isActive: true,
      registrationStatus: 'registered',
      totpSecret: secret.base32,
      totpEnabled: false
    });

    await adminUser.save();
    console.log('Admin user created successfully');

    // Generate QR code
    const otpauthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    console.log('\n========== ADMIN SETUP INFORMATION ==========');
    console.log('Email: b.beaw18@gmail.com');
    console.log('Password: KoonBeaw002!');
    console.log('Role: admin');
    console.log('\nTOTP Setup:');
    console.log('TOTP Secret (base32):', secret.base32);
    console.log('\nOtpauth URL:');
    console.log(otpauthUrl);
    console.log('\nQR Code (base64 data URL):');
    console.log(qrCodeDataUrl);
    console.log('\nInstructions:');
    console.log('1. Scan the QR code with Google Authenticator app');
    console.log('2. Use /api/auth/verify-totp-setup endpoint with userId and 6-digit code to enable TOTP');
    console.log('===========================================\n');

    // Disconnect from MongoDB
    await mongoose.connection.close();
    console.log('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seedDatabase();
