const axios = require('axios');
const { createHmac, timingSafeEqual } = require('crypto');
const LineConnection = require('../models/LineConnection');

const lineUserId = /^U[0-9a-f]{32}$/;
const authApi = 'https://api.line.me';
const timeout = 8000;

async function verifyIdentity(idToken) {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId || typeof idToken !== 'string' || !idToken) return null;
  const response = await axios.post(`${authApi}/oauth2/v2.1/verify`,
    new URLSearchParams({ id_token: idToken, client_id: clientId }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout,
      validateStatus: status => status < 500
    });
  const identity = response.data;
  if (response.status !== 200 || identity.aud !== clientId || identity.iss !== 'https://access.line.me'
    || !(identity.exp > Date.now() / 1000) || !lineUserId.test(identity.sub)) return null;
  return identity.sub;
}

async function verifyFriendship(userId, accessToken) {
  if (typeof accessToken !== 'string' || !accessToken) return null;
  const config = { timeout, validateStatus: status => status < 500 };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [token, profile, friendship] = await Promise.all([
    axios.get(`${authApi}/oauth2/v2.1/verify`, { ...config, params: { access_token: accessToken } }),
    axios.get(`${authApi}/v2/profile`, { ...config, headers }),
    axios.get(`${authApi}/friendship/v1/status`, { ...config, headers })
  ]);
  if ([token, profile, friendship].some(response => response.status !== 200)
    || token.data.client_id !== process.env.LINE_LOGIN_CHANNEL_ID || Number(token.data.expires_in) <= 0
    || profile.data.userId !== userId || typeof friendship.data.friendFlag !== 'boolean') return null;
  return friendship.data.friendFlag;
}

function validSignature(raw, signature) {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  if (!secret || !Buffer.isBuffer(raw) || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', secret).update(raw).digest('base64');
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(Buffer.from(expected), received);
}

async function observeFriendship(userId, friend, time) {
  try {
    await LineConnection.updateOne({ _id: userId, observedAt: { $not: { $gte: time } } },
      { $set: { friend, observedAt: time } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    // An older or duplicate delivery cannot overwrite a more recent observation.
    await LineConnection.updateOne({ _id: userId, observedAt: { $lt: time } },
      { $set: { friend, observedAt: time } });
  }
}

module.exports = { verifyIdentity, verifyFriendship, validSignature, observeFriendship, lineUserId };
