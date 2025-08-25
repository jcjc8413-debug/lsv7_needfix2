import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const event = await req.json()
    
    // Verify webhook signature (implement based on Ziina's webhook verification)
    const signature = req.headers.get('ziina-signature')
    if (!signature) {
      return new Response('No signature', { status: 400 })
    }

    // Handle different Ziina webhook events
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data
        
        // Get payment intent from database
        const { data: dbPaymentIntent, error: fetchError } = await supabase
          .from('payment_intents')
          .select('*')
          .eq('ziina_payment_intent_id', paymentIntent.id)
          .single()

        if (fetchError || !dbPaymentIntent) {
          console.error('Payment intent not found:', paymentIntent.id)
          break
        }

        // Calculate period end based on plan
        const now = new Date()
        let periodEnd: Date
        
        switch (dbPaymentIntent.plan_type) {
          case 'monthly':
            periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            break
          case 'semiannual':
            periodEnd = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)
            break
          case 'annual':
            periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            break
          default:
            periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        }

        // Update or create subscription
        const { error: subscriptionError } = await supabase
          .from('subscriptions')
          .upsert({
            user_id: dbPaymentIntent.user_id,
            plan_type: dbPaymentIntent.plan_type,
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
          }, {
            onConflict: 'user_id'
          })

        if (subscriptionError) {
          console.error('Error updating subscription:', subscriptionError)
        }

        // Update payment intent status
        await supabase
          .from('payment_intents')
          .update({ status: 'succeeded' })
          .eq('id', dbPaymentIntent.id)

        break
      }

      case 'payment_intent.failed': {
        const paymentIntent = event.data
        
        // Update payment intent status
        await supabase
          .from('payment_intents')
          .update({ status: 'failed' })
          .eq('ziina_payment_intent_id', paymentIntent.id)

        break
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(`Webhook error: ${error.message}`, { 
      status: 400,
      headers: corsHeaders 
    })
  }
})