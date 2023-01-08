var express = require('express')
var app = express()
var cors = require('cors')
var bodyParser = require('body-parser')

// ENV Config
require('dotenv').config()

// PayPal Config
var paypal = require('paypal-rest-sdk')
const paypal_ = require('@paypal/payouts-sdk')

paypal.configure({
  mode: 'sandbox',
  client_id: process.env.CLIENT_ID,
  client_secret: process.env.CLIENT_SECRET,
})

app.use(cors())

// Body Parser Config...
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// set the view engine to ejs
app.set('view engine', 'ejs')

// use res.render to load up an ejs view file

// index page
app.get('/', function (req, res) {
  res.render('pages/index')
})

app.post('/pay', function (req, res) {
  const data = req.body

  const create_payment_json = {
    intent: 'sale',
    payer: {
      payment_method: 'paypal',
    },
    redirect_urls: {
      return_url: 'http://localhost:8080/success',
      cancel_url: 'http://localhost:8080/cancel',
    },
    transactions: [
      {
        item_list: {
          items: [
            {
              name: 'RedHat',
              sku: '001',
              price: `${req.body.amount}`,
              currency: `${req.body.cType}`,
              quantity: 1,
            },
          ],
        },
        amount: {
          currency: `${req.body.cType}`,
          total: `${req.body.amount}`,
        },
        description: 'This is a payment for purchasing a Hat',
      },
    ],
  }

  paypal.payment.create(create_payment_json, function (error, payment) {
    if (error) {
      throw error
    } else {
      for (let i = 0; i < payment.links.length; i++) {
        if (payment.links[i].rel === 'approval_url') {
          res.redirect(payment.links[i].href)
        }
      }
    }
  })

  app.get('/success', (req, res) => {
    const payerId = req.query.PayerID
    const paymentId = req.query.paymentId

    const execute_payment_json = {
      payer_id: payerId,
      transactions: [
        {
          amount: {
            currency: `${data.cType}`,
            total: `${data.amount}`,
          },
        },
      ],
    }

    paypal.payment.execute(paymentId, execute_payment_json, function (
      error,
      payment,
    ) {
      if (error) {
        console.log(error.response)
        throw error
      } else {
        console.log(JSON.stringify(payment))
        res.send('Success')
      }
    })
  })

  app.get('/cancel', (req, res) => res.send('Cancelled'))
})

app.post('/pay-batch', async function (req, res) {
  const data = req.body

  const clientId = process.env.CLIENT_ID
  const clientSecret = process.env.CLIENT_SECRET
  const environment = new paypal_.core.SandboxEnvironment(
    clientId,
    clientSecret,
  )
  const client = new paypal_.core.PayPalHttpClient(environment)

  const requestBody = {
    sender_batch_header: {
      recipient_type: 'EMAIL',
      email_message: 'SDK payouts test txn',
      note: 'Enjoy your Payout!!',
      sender_batch_id: '20230106',
      email_subject: 'This is a test transaction from SDK',
    },
    items: [
      {
        note: 'Your Payout!',
        amount: {
          currency: `${data.cType}`,
          value: `${data.amount}`,
        },
        receiver: `${data.email}`,
        sender_item_id: '20230106_1',
      },
      {
        note: 'Your Payout!',
        amount: {
          currency: `${data.cType2}`,
          value: `${data.amount2}`,
        },
        receiver: `${data.email2}`,
        sender_item_id: '20230106_2',
      },
    ],
  }

  // Construct a request object and set desired parameters
  // Here, PayoutsPostRequest() creates a POST request to /v1/payments/payouts
  let request = new paypal_.payouts.PayoutsPostRequest()
  request.requestBody(requestBody)

  // Call API with your client and get a response for your call
  let createPayouts = async function () {
    let response = await client.execute(request)
    console.log(`Response: ${JSON.stringify(response)}`)
    // If call returns body in response, you can get the deserialized version from the result attribute of the response.
    console.log(`Payouts Create Response: ${JSON.stringify(response.result)}`)
  }

  let createResponse = await createPayouts()
  if (createResponse.statusCode === 201) {
    //Retrieve Payout Batch details
    let payoutId = createResponse.result.batch_header.payout_batch_id
    console.log('Retrieving Payout details for id - ' + payoutId)
    let getResponse = await getPayout(payoutId, true)
    if (getResponse.statusCode === 200) {
      //Retrieve Payout Item details
      let payoutItemId = getResponse.result.items[0].payout_item_id
      console.log('Retrieving Payout Item details for id - ' + payoutItemId)
      let getItemResponse = await getPayoutItem(payoutItemId, true)
      if (getItemResponse.statusCode === 200) {
        let i = 0
        //Wail till Payout Batch status becomes SUCCESS to cancel an UNCLAIMED payout.
        //This is just for demonstration, defer using this while integration
        //Note: While integrating use Webhooks to get realtime Payouts Batch and Item status updates
        do {
          let checkPayoutComplete = await getPayout(payoutId)
          await sleep(2000)
          if (
            checkPayoutComplete.result.batch_header.batch_status === 'SUCCESS'
          ) {
            //Cancel UNCLAIMED payout item
            console.log(
              'Cancelling unclaimed payout item for id - ' + payoutItemId,
            )
            let cancelResponse = await cancelPayoutItem(payoutItemId, true)
            if (getItemResponse.statusCode === 200) {
              console.log(
                'Unclaimed payout item cancelled successfully for id - ' +
                  payoutItemId,
              )

              //Run cancel failure scenario
              console.log(
                'Simulate failure on cancelling an already cancelled Payout item with id: ' +
                  payoutItemId,
              )
              await cancelPayoutItem(payoutItemId, true)
            } else {
              console.error(
                'Failed to cancel unclaimed payout item for id - ' +
                  payoutItemId,
              )
            }
            break
          }
          i++
        } while (i < 5)
        if (i === 5) {
          console.error("Batch hasn't processed successfully yet!!")
        }
      } else {
        console.error(
          'Failed to retrieve payout item details for id - ' + payoutItemId,
        )
      }
    } else {
      console.error('Failed to retrieve payout details for id - ' + payoutId)
    }
  } else {
    console.error('Failed to create payout')
  }
})

app.post('/pay-invoice', function (req, res) {
  var data = req.body

  var create_invoice_json = {
    merchant_info: {
      email: `${data.invoice_email}`,
      first_name: 'Dennis',
      last_name: 'Doctor',
      business_name: `${data.invoice_cName}`,
      phone: {
        country_code: '001',
        national_number: '5032141716',
      },
      address: {
        line1: '1234 Main St.',
        city: 'Portland',
        state: 'OR',
        postal_code: '97217',
        country_code: 'US',
      },
    },
    billing_info: [
      {
        email: `${data.invoice_to_email}`,
      },
    ],
    items: [
      {
        name: 'Sutures',
        quantity: 1,
        unit_price: {
          currency: `${data.invoice_currency}`,
          value: `${data.invoice_subTotal}`,
        },
      },
    ],
    note: 'Medical Invoice 16 Jul, 2013 PST',
    payment_term: {
      term_type: 'NET_45',
    },
    shipping_info: {
      first_name: 'Sally',
      last_name: 'Patient',
      business_name: 'Not applicable',
      phone: {
        country_code: '001',
        national_number: '5039871234',
      },
      address: {
        line1: '1234 Broad St.',
        city: 'Portland',
        state: 'OR',
        postal_code: '97216',
        country_code: 'US',
      },
    },
    tax_inclusive: false,
    total_amount: {
      currency: `${data.invoice_currency}`,
      value: `${data.invoice_subTotal + data.invoice_shipping}`,
    },
  }

  paypal.invoice.create(create_invoice_json, function (error, invoice) {
    if (error) {
      throw error
    } else {
      console.log('Create Invoice Response')
      var invoiceId = invoice.id;

      paypal.invoice.send(invoiceId, function (error, rv) {
        if (error) {
          console.log(error.response)
          throw error
        } else {
          console.log('Send Invoice Response')
          console.log(rv)
        }
      })
    }
  })
})

// Port Setup...
const port = process.env.PORT || 8080

// Start Server...
app.listen(port, () => {
  console.log(`Server is running on ${port}`)
})
