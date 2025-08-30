import express from 'express';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create checkout session for payment
router.post('/create-checkout-session', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Missing payment data.' });
  }
  
  const { quantity, amount, name, email, url } = req.body;
  
  if (!quantity || !amount || !email || !url) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: name || 'AI GEO Visibility Report',
          },
          unit_amount: amount,
        },
        quantity: quantity,
      }],
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&url=${encodeURIComponent(url)}`,
      cancel_url: `${req.headers.origin}/cancel`,
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment initiation failed.' });
  }
});

// Verify payment status (optional webhook endpoint)
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment succeeded:', session.id);
      // You can add logic here to trigger report generation
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

export default router;
