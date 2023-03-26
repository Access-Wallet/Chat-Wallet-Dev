import { useState, useEffect, useRef } from 'react'
import SocialLogin from '@biconomy/web3-auth'
import { ChainId } from '@biconomy/core-types'
import { IBalances } from '@biconomy/node-client'
import { ethers } from 'ethers'
import SmartAccount from '@biconomy/smart-account'
import { css } from '@emotion/css'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const tokens = [
  {
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    decimals: 6,
    symbol: 'USDC'
  },
  {
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    decimals: 6,
    symbol: 'USDT'
  },
  {
    address: '0x0000000000000000000000000000000000001010',
    decimals: 18,
    symbol: 'MATIC',
  },
  {
    address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    decimals: 18,
    symbol: 'DAI'
  },
  {
    address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    decimals: 18,
    symbol: 'WETH'
  },
  {
    // address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    decimals: 18,
    symbol: 'ETH'
  },
  {
    address: '0x4200000000000000000000000000000000000042',
    decimals: 18,
    symbol: 'OP'
  },
  {
    address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb',
    decimals: 18,
    symbol: 'GNO'
  }
]

export default function Home() {
  const [smartAccount, setSmartAccount] = useState<SmartAccount | null>(null)
  const [interval, enableInterval] = useState<boolean>(false)
  const sdkRef = useRef<SocialLogin | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  // Forwarder config
  const [amount, setAmount] = useState<string>('')
  const [balances, setBalances] = useState<IBalances[]>([])
  const [gasToken, setGasToken] = useState<IBalances | null>()
  const [recipientAddress, setRecipientAddress] = useState<string>('')
  const [selectedToken, setSelectedToken] = useState(tokens[0])
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    let configureLogin
    if (interval) {
      configureLogin = setInterval(() => {
        if (!!sdkRef.current?.provider) {
          setupSmartAccount()
          clearInterval(configureLogin)
        }
      }, 1000)
    }
  }, [interval])

  async function login() {
    if (!sdkRef.current) {
      const socialLoginSDK = new SocialLogin()    
      await socialLoginSDK.init(ethers.utils.hexValue(ChainId.POLYGON_MAINNET))
      sdkRef.current = socialLoginSDK
    }
    if (!sdkRef.current.provider) {
      sdkRef.current.showConnectModal()
      sdkRef.current.showWallet()
      enableInterval(true)
    } else {
      setupSmartAccount()
    }
  }

  async function setupSmartAccount() {
    if (!sdkRef?.current?.provider) return
    sdkRef.current.hideWallet()
    setLoading(true)
    const web3Provider = new ethers.providers.Web3Provider(
      sdkRef.current.provider
    )
    try {
      const smartAccount = new SmartAccount(web3Provider, {
        activeNetworkId: ChainId.POLYGON_MAINNET,
        supportedNetworksIds: [ChainId.POLYGON_MAINNET],
      })
      await smartAccount.init()
      setSmartAccount(smartAccount)
      setLoading(false)
      getBalance(smartAccount)
    } catch (err) {
      console.log('error setting up smart account... ', err)
    }
  }

  const logout = async () => {
    if (!sdkRef.current) {
      console.error('Web3Modal not initialized.')
      return
    }
    await sdkRef.current.logout()
    sdkRef.current.hideWallet()
    setSmartAccount(null)
    enableInterval(false)
  }

  async function getBalance(smartAccount: SmartAccount) {
    if (!smartAccount) return
    console.log('smartAccount: ', smartAccount)
    /* this function fetches the balance of the connected smart wallet */
    const balanceParams =  {
      chainId: ChainId.POLYGON_MAINNET,
      eoaAddress: smartAccount.address,
      tokenAddresses: [],
    }
    console.log('smartAccount: ', smartAccount)
    /* use getAlltokenBalances and getTotalBalanceInUsd query the smartAccount */
    const balFromSdk = await smartAccount.getAlltokenBalances(balanceParams)
    console.log('balFromSdk::: ', balFromSdk)
    const usdBalFromSdk = await smartAccount.getTotalBalanceInUsd(balanceParams)
    console.log('usdBalFromSdk: ', usdBalFromSdk)
    setBalances(balFromSdk.data)
    setGasToken(balFromSdk.data[0])
  }

  function onGasTokenChange(e) {
    setGasToken(balances[e.target.value])
  }

  function onTokenChange(e) {
    setSelectedToken(tokens[e.target.value])
  }

  async function sendTokens() {
    if (!smartAccount || !gasToken) return
    let tx

    /* if the selected token to send is the native token, configure a basic transaction */
    if (selectedToken.symbol === 'MATIC') {
      tx = {
        to: recipientAddress,
        value: ethers.utils.parseEther(amount)
      }
    } else {
     /* if the selected to send is not a native token (i.e. not MATIC), then configure a custom transaction */
     const erc20Interface = new ethers.utils.Interface([
        'function transfer(address _to, uint256 _value)'
      ])
      const data = erc20Interface.encodeFunctionData(
        'transfer', [recipientAddress, ethers.utils.parseUnits(amount, selectedToken.decimals)]
      )
      tx = {
        to: selectedToken.address,
        data
      }
    }

    /* check the fee quotes from the API */
    /* in our case we're letting the user choose which token to pay gas */
    const feeQuotes = await smartAccount.prepareRefundTransaction(
      {transaction:tx}
    )
    console.log('feeQuotes: ', feeQuotes)

    /* find the matching fee quote to the selected gas token the user has chosen */
    const feeQuote = feeQuotes.find(quote => quote.symbol === gasToken.contract_ticker_symbol)

    if (!feeQuote) {
      console.log('no matching quote ...')
      return
    }

    /* define the transaction */
    const transaction = await smartAccount.createRefundTransaction({
      transaction: tx,
      feeQuote
    })

    let gasLimit = {
      hex: '0x1E8480',
      type: 'hex',
    }

    /* send the transaction */
    try {
      const txId = await smartAccount.sendTransaction({
        tx: transaction,
        gasLimit
      })
      console.log({ txId })
    } catch (err) {
      console.log('ERROR SENDING TX: ', err)
    }
  }

  return (
    <div className={containerStyle}>
      <h1 className={headerStyle}>Access Wallet</h1>
      {
        !smartAccount && !loading && <button className={buttonStyle} onClick={login}>Login</button>
      }
      {
        loading && <p>Loading account details...</p>
      }
      {
        !!smartAccount && (
          <div className={detailsContainerStyle}>
            <h3>Smart account address:</h3>
            <p>{smartAccount.address}</p>
            <button className={buttonStyle} onClick={logout}>Logout</button>
            <div className={tokenBalancesContainerStyle}>
            {
              balances.map((balance, index) => {
                return (
                  <div key={index} >
                    <p>{balance.contract_name} - {balance.contract_ticker_symbol} - {ethers.utils.formatUnits(balance.balance, balance.contract_decimals)}</p>
                  </div>
                )
              })
            }
            </div>
            <div className={formContainerStyle}>
              <input
                value={recipientAddress}
                placeholder="recipient's address"
                onChange={e => setRecipientAddress(e.target.value)}
                className={inputStyle}
              />
              <input
                value={amount}
                placeholder='amount'
                onChange={e => setAmount(e.target.value)}
                className={inputStyle}
              />
               <p>Choose which token you'd like to send</p>
              <select className={selectStyle} name='tokens' id='tokens' onChange={onTokenChange}>
                {
                  tokens.map((token, index) => (
                    <option
                      key={index}
                      value={index}
                    >{token.symbol}</option>
                  ))
                }
              </select>
              <p>Choose which token to pay gas in</p>
              <select className={selectStyle} name='tokens' id='tokens' onChange={onGasTokenChange}>
                {
                  balances.map((balance, index) => (
                    <option
                    key={index}
                    value={index}
                    >{balance.contract_ticker_symbol}</option>
                  ))
                }
              </select>
              <button className={buttonStyle} onClick={sendTokens}>sendTokens</button>
            </div>
            <div className={formContainerStyle}>
              <div className={chatBoxStyle}>
                <div className={chatStyle}>
                  <p className={sentStyle}>Hi there!</p>
                </div>
                <div className={chatStyle}>
                  <p className={receivedStyle}>How can I help you today?</p>
                </div>
                <div className={inputContainerStyle}>
                  <input
                    className={chatInputStyle}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                  />
                  <button className={buttonStyle} onClick={()=>{alert("Testing")}}>
                    {/* Send */}
                    <FontAwesomeIcon icon={faPaperPlane} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div>
  )
}

const formContainerStyle = css`
  display: flex;
  flex-direction: column;
  margin-top: 15px;
`

const inputStyle = css`
  outline: none;
  width: 280px;
  border-radius: 20px;
  border: none;
  padding: 12px 16px;
  margin-bottom: 5px;
  background-color: rgba(0, 0, 0, .1);
`

const selectStyle = css`
  width: 230px;
  padding: 7px 11px;
  margin: 0px 0px 9px;
  border-radius: 10px
`

const tokenBalancesContainerStyle = css`
  margin-top: 15px;
`

const detailsContainerStyle = css`
  margin-top: 10px;
`

const buttonStyle = css`
  padding: 14px;
  width: 300px;
  border: none;
  cursor: pointer;
  border-radius: 999px;
  outline: none;
  margin-top: 20px;
  transition: all .25s;
  &:hover {
    background-color: rgba(0, 0, 0, .2); 
  }
`

const headerStyle = css`
  font-size: 44px;
`

const containerStyle = css`
  width: 900px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  flex-direction: column;
  padding-top: 100px;
  @media (max-width: 900px) {
    width: 100%;
  }
`

const chatBoxStyle = css`
  display: flex;
  flex-direction: column;
  width: 400px;
  height: 500px;
  background-color: #f5f5f5;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  padding: 20px;
  overflow-y: scroll;
`

const chatStyle = css`
  display: flex;
  align-items: center;
  margin-bottom: 10px;
`

const receivedStyle = css`
  background-color: #0084ff;
  color: #fff;
  padding: 10px 15px;
  border-radius: 20px;
  max-width: 70%;
  margin-right: 10px;
  font-size: 16px;
  font-weight: 500;
  position: relative;
  &:after {
    content: '';
    position: absolute;
    bottom: 0;
    left: -8px;
    border-style: solid;
    border-width: 0 8px 8px 0;
    border-color: transparent #0084ff transparent transparent;
  }
`

const sentStyle = css`
  background-color: #ebebeb;
  color: #fff;
  padding: 10px 15px;
  border-radius: 20px;
  max-width: 70%;
  margin-right: 10px;
  font-size: 16px;
  font-weight: 500;
  position: relative;
  &:after {
    content: '';
    position: absolute;
    bottom: 0;
    left: -8px;
    border-style: solid;
    border-width: 0 8px 8px 0;
    border-color: transparent #0084ff transparent transparent;
  }
`

const inputContainerStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
`;

const chatInputStyle = css`
  padding: 10px;
  border-radius: 5px;
  border: none;
  flex-grow: 1;
  margin-right: 10px;
`;

const chatButtonStyle = css`
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 10px;
`;