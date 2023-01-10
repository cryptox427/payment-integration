var express = require('express')
var app = express()
var cors = require('cors')
var bodyParser = require('body-parser')
// ENV Config
require('dotenv').config()
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

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

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// use res.render to load up an ejs view file

// index page
app.get('/', function (req, res) {
  res.render('pages/index')
})

app.post('/webhook', function (req, res) {
  console.log('WEBHOOK >>>>>>>>>>>>>>>>>', req.body)
  if (req.body?.event_type === "PAYMENT.SALE.COMPLETED" && io) {
    io.emit("webhooks", req.body)
  }
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
})

app.get('/success', (req, res) => {
  const payerId = req.query.PayerID
  const paymentId = req.query.paymentId

  paypal.payment.get(paymentId, function (error, payment) {
    if (error) {
      console.log(error)
      throw error
    } else {
      const execute_payment_json = {
        payer_id: payerId,
        transactions: [
          {
            amount: {
              currency: `${payment.transactions[0].amount.currency}`,
              total: `${payment.transactions[0].amount.total}`,
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
          res.render('pages/index')
        }
      })
    }
  })
})

app.get('/cancel', (req, res) => res.render('pages/index'))

app.post('/pay-batch', async function (req, res) {
  const data = req.body

  const sender_batch_id = Math.random().toString(36).substring(9)

  const create_payout_json = {
    sender_batch_header: {
      sender_batch_id: sender_batch_id,
      email_subject: 'You have a payment',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: {
          value: `${data.amount}`,
          currency: `${data.cType}`,
        },
        receiver: `${data.email}`,
        note: 'Thank you.',
        sender_item_id: `${sender_batch_id}_1`,
      },
      {
        recipient_type: 'EMAIL',
        amount: {
          value: `${data.amount2}`,
          currency: `${data.cType2}`,
        },
        receiver: `${data.email2}`,
        note: 'Thank you.',
        sender_item_id: `${sender_batch_id}_2`,
      },
    ],
  }

  paypal.payout.create(create_payout_json, async function (
    error,
    createResponse,
  ) {
    if (error) {
      console.log(error.response)
      throw error
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10000))
      let getResponse = await getPayout(
        createResponse.batch_header.payout_batch_id,
        true,
      )
      console.log('GET RESPONSE >>>>>', getResponse)
      if (getResponse.httpStatusCode === 200) {
        //Retrieve Payout Item details
        let payoutItemId = getResponse.items[0].payout_item_id
        console.log('Retrieving Payout Item details for id - ' + payoutItemId)
        let getItemResponse = await getPayoutItem(payoutItemId, true)
        console.log(getItemResponse)
        if (getItemResponse.statusCode === 200) {
          let i = 0
          //Wail till Payout Batch status becomes SUCCESS to cancel an UNCLAIMED payout.
          //This is just for demonstration, defer using this while integration
          //Note: While integrating use Webhooks to get realtime Payouts Batch and Item status updates
          do {
            let checkPayoutComplete = await getPayout(payoutId, true)
            await sleep(2000)
            if (checkPayoutComplete.batch_header.batch_status === 'SUCCESS') {
              //Cancel UNCLAIMED payout item
              console.log(
                'Cancelling unclaimed payout item for id - ' + payoutItemId,
              )
              await cancelPayoutItem(payoutItemId, true)
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
      }
    }
  })
})

app.post('/pay-invoice', function (req, res) {
  var data = req.body
  console.log(data, 'data')

  var create_invoice_json = {
    merchant_info: {
      email: `${data.invoice_email}`,
      first_name: 'John',
      last_name: 'Doe',
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
      console.log(error, 'error')
      throw error
    } else {
      console.log('Create Invoice Response')
      var invoiceId = invoice.id
      console.log(invoiceId, 'id')
      paypal.invoice.send(invoiceId, function (error, rv) {
        if (error) {
          console.log(error.response, 'err')
          throw error
        } else {
          console.log('Send Invoice Response')
          console.log(rv)
          res.render('pages/index')
        }
      })
    }
  })
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getPayout(payoutId, status) {
  paypal.payout.get(payoutId, function (error, payout) {
    if (error) {
      console.log(error)
      throw error
    } else {
      // console.log('Get Payout Response')
      // console.log(JSON.stringify(payout))
      return payout
    }
  })
}

async function getPayoutItem(payoutId, status) {
  paypal.payoutItem.get(payoutId, function (error, payoutItem) {
    if (error) {
      console.log(error)
      throw error
    } else {
      // console.log('Get payoutItem Response')
      // console.log(JSON.stringify(payoutItem))
      return payoutItem
    }
  })
}

async function cancelPayoutItem(payoutId, status) {
  paypal.payoutItem.cancel(payoutId, function (error, payoutItemDetails) {
    if (error) {
      console.log(error.response)
      throw error
    } else {
      // console.log('Cancel payoutItem Response')
      // console.log(JSON.stringify(payoutItemDetails))
      return payoutItemDetails
    }
  })
}

// Port Setup...
const port = process.env.PORT || 8080

// Start Server...
server.listen(port, () => {
  console.log(`Server is running on ${port}`)
})
