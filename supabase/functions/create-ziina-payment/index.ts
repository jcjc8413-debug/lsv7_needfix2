import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface PaymentRequest {
  planType: 'monthly' | 'semiannual' | 'annual'
  autoRenew: boolean
  successUrl: string
  cancelUrl: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      throw new Error('Unauthorized')
    }

    const { planType, autoRenew, successUrl, cancelUrl }: PaymentRequest = await req.json()

    // Check if Ziina is configured
    const ziinaAccessToken = Deno.env.get('ZIINA_ACCESS_TOKEN')
    if (!ziinaAccessToken) {
      throw new Error('Ziina not configured. Please configure ZIINA_ACCESS_TOKEN environment variable.')
    }

    // Define plan amounts (in fils - Ziina uses fils, not AED)
    const planAmounts = {
      monthly: 299, // 2.99 AED = 299 fils
      semiannual: 999, // 9.99 AED = 999 fils
      annual: 1999 // 19.99 AED = 1999 fils
    }

    const amount = planAmounts[planType]
    if (!amount) {
      throw new Error(`Invalid plan type: ${planType}`)
    }

    // Create Ziina payment intent
    const ziinaResponse = await fetch('https://api.ziina.com/v1/payment_intent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ziinaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'AED',
        description: `Voya ${planType} subscription`,
        metadata: {
          user_id: user.id,
          plan_type: planType,
          auto_renew: autoRenew.toString(),
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      })
    })

    if (!ziinaResponse.ok) {
      const errorData = await ziinaResponse.text()
      console.error('Ziina API error:', errorData)
      throw new Error('Payment processing temporarily unavailable. Please try again.')
    }

    const paymentIntent = await ziinaResponse.json()

    // Store payment intent in your database for webhook processing
    await supabaseClient
      .from('payment_intents')
      .insert({
        id: paymentIntent.id,
        user_id: user.id,
        plan_type: planType,
        auto_renew: autoRenew,
        amount: amount,
        status: 'pending',
        ziina_payment_intent_id: paymentIntent.id
      })

    return new Response(
      JSON.stringify({ 
        redirectUrl: paymentIntent.redirect_url,
        paymentIntentId: paymentIntent.id 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating Ziina payment:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})