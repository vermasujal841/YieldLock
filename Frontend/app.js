// YieldLock Frontend Application
class YieldLockApp {
    constructor() {
        // Contract configuration
        this.contractAddress = '0xAF271890751D1D4f3cEe2e053ff682c60b346aA7';
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.userAccount = null;
        this.isAdmin = false;

        // Contract ABI (simplified - you should use your complete ABI)
        this.contractABI = [
            // View functions
            "function getPoolInfo(uint256 poolId) view returns (address lpToken, uint256 rewardRate, uint256 lockDuration, uint256 totalStaked, bool isActive)",
            "function getUserStake(address user, uint256 poolId) view returns (uint256 amount, uint256 lockEndTime, uint256 pendingRewards, bool isLocked)",
            "function getPoolCount() view returns (uint256)",
            "function pendingRewards(address user, uint256 poolId) view returns (uint256)",
            "function owner() view returns (address)",
            
            // State changing functions
            "function stake(uint256 poolId, uint256 amount)",
            "function unstake(uint256 poolId)",
            "function claimRewards(uint256 poolId)",
            "function createPool(address lpToken, uint256 rewardRate, uint256 lockDuration)",
            "function pausePool(uint256 poolId)",
            "function unpausePool(uint256 poolId)",
            
            // Events
            "event Staked(address indexed user, uint256 indexed poolId, uint256 amount)",
            "event Unstaked(address indexed user, uint256 indexed poolId, uint256 amount)",
            "event RewardsClaimed(address indexed user, uint256 indexed poolId, uint256 amount)",
            "event PoolCreated(uint256 indexed poolId, address lpToken, uint256 rewardRate, uint256 lockDuration)"
        ];

        // Initialize the application
        this.init();
    }

    async init() {
        await this.setupEventListeners();
        await this.checkWeb3();
        this.updateUI();
    }

    // Web3 Setup
    async checkWeb3() {
        if (typeof window.ethereum !== 'undefined') {
            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            
            // Check if already connected
            const accounts = await this.provider.listAccounts();
            if (accounts.length > 0) {
                await this.connectWallet();
            }
        } else {
            this.showMessage('Please install MetaMask to use this application', 'error');
        }
    }

    async connectWallet() {
        try {
            this.showLoading(true);
            
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            this.signer = this.provider.getSigner();
            this.userAccount = await this.signer.getAddress();
            
            // Initialize contract
            this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.signer);
            
            // Check if user is admin
            await this.checkAdminStatus();
            
            // Update UI
            await this.updateWalletInfo();
            await this.loadUserData();
            
            this.showMessage('Wallet connected successfully!', 'success');
            
        } catch (error) {
            console.error('Error connecting wallet:', error);
            this.showMessage('Failed to connect wallet: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async checkAdminStatus() {
        try {
            const owner = await this.contract.owner();
            this.isAdmin = owner.toLowerCase() === this.userAccount.toLowerCase();
            
            // Show/hide admin panel
            const adminPanel = document.getElementById('adminPanel');
            if (adminPanel) {
                adminPanel.style.display = this.isAdmin ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
        }
    }

    async updateWalletInfo() {
        try {
            const balance = await this.provider.getBalance(this.userAccount);
            const formattedBalance = ethers.utils.formatEther(balance);
            
            document.getElementById('walletAddress').textContent = 
                this.userAccount.slice(0, 6) + '...' + this.userAccount.slice(-4);
            document.getElementById('walletBalance').textContent = 
                `${parseFloat(formattedBalance).toFixed(4)} ETH`;
            
            // Show wallet info, hide connect button
            document.getElementById('connectWallet').style.display = 'none';
            document.getElementById('walletInfo').style.display = 'block';
            
        } catch (error) {
            console.error('Error updating wallet info:', error);
        }
    }

    async loadUserData() {
        try {
            await this.loadPoolData();
            await this.loadUserStakes();
            await this.loadProtocolStats();
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async loadPoolData() {
        try {
            const poolCount = await this.contract.getPoolCount();
            const farmPoolsContainer = document.getElementById('farmPools');
            farmPoolsContainer.innerHTML = '';

            for (let i = 0; i < poolCount; i++) {
                const poolInfo = await this.contract.getPoolInfo(i);
                const poolCard = this.createPoolCard(i, poolInfo);
                farmPoolsContainer.appendChild(poolCard);
            }
        } catch (error) {
            console.error('Error loading pool data:', error);
            // Keep default pools if contract call fails
        }
    }

    createPoolCard(poolId, poolInfo) {
        const [lpToken, rewardRate, lockDuration, totalStaked, isActive] = poolInfo;
        
        const card = document.createElement('div');
        card.className = 'farm-card';
        
        // Calculate APY (simplified calculation)
        const apy = (rewardRate * 365 * 100 / Math.max(totalStaked, 1)).toFixed(0);
        
        card.innerHTML = `
            <div class="farm-header">
                <h3>Pool ${poolId}</h3>
                <span class="apy-badge">${apy}% APY</span>
            </div>
            <div class="farm-stats">
                <div class="stat">
                    <span class="label">Lock Period:</span>
                    <span class="value">${lockDuration / 86400} days</span>
                </div>
                <div class="stat">
                    <span class="label">Total Staked:</span>
                    <span class="value">${ethers.utils.formatEther(totalStaked)} LP</span>
                </div>
                <div class="stat">
                    <span class="label">Reward Rate:</span>
                    <span class="value">${ethers.utils.formatEther(rewardRate)} /day</span>
                </div>
                <div class="stat">
                    <span class="label">Status:</span>
                    <span class="value ${isActive ? 'text-success' : 'text-error'}">${isActive ? 'Active' : 'Paused'}</span>
                </div>
            </div>
            <div class="farm-actions">
                <input type="number" placeholder="Amount to stake" class="stake-input" data-pool="${poolId}" step="0.01">
                <button class="btn btn-success stake-btn" data-pool="${poolId}" ${!isActive ? 'disabled' : ''}>
                    ${isActive ? 'Stake LP Tokens' : 'Pool Paused'}
                </button>
            </div>
        `;
        
        return card;
    }

    async loadUserStakes() {
        try {
            if (!this.contract || !this.userAccount) return;
            
            const poolCount = await this.contract.getPoolCount();
            const stakesContainer = document.getElementById('userStakes');
            stakesContainer.innerHTML = '';
            
            let hasStakes = false;
            
            for (let i = 0; i < poolCount; i++) {
                const userStake = await this.contract.getUserStake(this.userAccount, i);
                const [amount, lockEndTime, pendingRewards, isLocked] = userStake;
                
                if (amount.gt(0)) {
                    hasStakes = true;
                    const stakeItem = this.createStakeItem(i, userStake);
                    stakesContainer.appendChild(stakeItem);
                }
            }
            
            if (!hasStakes) {
                stakesContainer.innerHTML = '<p class="text-secondary">No active stakes found.</p>';
            }
            
        } catch (error) {
            console.error('Error loading user stakes:', error);
        }
    }

    createStakeItem(poolId, stakeData) {
        const [amount, lockEndTime, pendingRewards, isLocked] = stakeData;
        const unlockDate = new Date(lockEndTime * 1000);
        const now = new Date();
        const isUnlocked = now >= unlockDate;
        
        const stakeItem = document.createElement('div');
        stakeItem.className = 'stake-item';
        
        stakeItem.innerHTML = `
            <div class="stake-info">
                <span class="pool-name">Pool ${poolId}</span>
                <span class="stake-amount">${ethers.utils.formatEther(amount)} LP</span>
            </div>
            <div class="stake-details">
                <div class="detail">
                    <span class="label">Locked Until:</span>
                    <span class="value unlock-date">${unlockDate.toLocaleDateString()}</span>
                </div>
                <div class="detail">
                    <span class="label">Pending Rewards:</span>
                    <span class="value">${ethers.utils.formatEther(pendingRewards)} YLD</span>
                </div>
                <div class="detail">
                    <span class="label">Status:</span>
                    <span class="value ${isUnlocked ? 'text-success' : 'text-warning'}">
                        ${isUnlocked ? 'Unlocked' : 'Locked'}
                    </span>
                </div>
            </div>
            <div class="stake-actions">
                <button class="btn btn-secondary claim-btn" data-pool="${poolId}" 
                        ${pendingRewards.eq(0) ? 'disabled' : ''}>
                    Claim Rewards
                </button>
                <button class="btn btn-warning unstake-btn" data-pool="${poolId}" 
                        ${!isUnlocked ? 'disabled' : ''}>
                    ${isUnlocked ? 'Unstake' : 'Unstake (Locked)'}
                </button>
            </div>
        `;
        
        return stakeItem;
    }

    async loadProtocolStats() {
        try {
            // This would typically come from your contract or subgraph
            // For now, we'll use placeholder data
            const stats = {
                totalValueLocked: '$2,450,000',
                activeFarmers: '1,250',
                rewardsDistributed: '125,000 YLD',
                averageLockTime: '45 days'
            };
            
            // You could implement actual contract calls to get real stats
            // Example: const tvl = await this.contract.getTotalValueLocked();
            
        } catch (error) {
            console.error('Error loading protocol stats:', error);
        }
    }

    // Event Listeners
    setupEventListeners() {
        // Connect wallet button
        document.getElementById('connectWallet').addEventListener('click', () => {
            this.connectWallet();
        });
        
        // Stake buttons (using event delegation)
        document.addEventListener('click', async (e) => {
            if (e.target.classList.contains('stake-btn')) {
                const poolId = e.target.dataset.pool;
                await this.stakeTokens(poolId);
            }
            
            if (e.target.classList.contains('claim-btn')) {
                const poolId = e.target.dataset.pool;
                await this.claimRewards(poolId);
            }
            
            if (e.target.classList.contains('unstake-btn')) {
                const poolId = e.target.dataset.pool;
                await this.unstakeTokens(poolId);
            }
        });
        
        // Admin functions
        const createPoolBtn = document.getElementById('createPoolBtn');
        if (createPoolBtn) {
            createPoolBtn.addEventListener('click', () => this.createPool());
        }
        
        const pausePoolBtn = document.getElementById('pausePoolBtn');
        if (pausePoolBtn) {
            pausePoolBtn.addEventListener('click', () => this.pausePool());
        }
        
        const unpausePoolBtn = document.getElementById('unpausePoolBtn');
        if (unpausePoolBtn) {
            unpausePoolBtn.addEventListener('click', () => this.unpausePool());
        }
        
        // Account change listener
        if (window.ethereum) {
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    this.disconnect();
                } else {
                    this.connectWallet();
                }
            });
            
            window.ethereum.on('chainChanged', () => {
                window.location.reload();
            });
        }
    }

    // Core Functions
    async stakeTokens(poolId) {
        try {
            if (!this.contract) {
                this.showMessage('Please connect your wallet first', 'error');
                return;
            }
            
            const input = document.querySelector(`input[data-pool="${poolId}"]`);
            const amount = input.value;
            
            if (!amount || parseFloat(amount) <= 0) {
                this.showMessage('Please enter a valid amount', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const amountWei = ethers.utils.parseEther(amount);
            const tx = await this.contract.stake(poolId, amountWei);
            
            this.showMessage('Transaction submitted! Waiting for confirmation...', 'warning');
            
            await tx.wait();
            
            this.showMessage('Successfully staked tokens!', 'success');
            
            // Clear input and reload data
            input.value = '';
            await this.loadUserData();
            
        } catch (error) {
            console.error('Error staking tokens:', error);
            this.showMessage('Failed to stake tokens: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async unstakeTokens(poolId) {
        try {
            if (!this.contract) {
                this.showMessage('Please connect your wallet first', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const tx = await this.contract.unstake(poolId);
            
            this.showMessage('Transaction submitted! Waiting for confirmation...', 'warning');
            
            await tx.wait();
            
            this.showMessage('Successfully unstaked tokens!', 'success');
            
            await this.loadUserData();
            
        } catch (error) {
            console.error('Error unstaking tokens:', error);
            this.showMessage('Failed to unstake tokens: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async claimRewards(poolId) {
        try {
            if (!this.contract) {
                this.showMessage('Please connect your wallet first', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const tx = await this.contract.claimRewards(poolId);
            
            this.showMessage('Transaction submitted! Waiting for confirmation...', 'warning');
            
            await tx.wait();
            
            this.showMessage('Successfully claimed rewards!', 'success');
            
            await this.loadUserData();
            
        } catch (error) {
            console.error('Error claiming rewards:', error);
            this.showMessage('Failed to claim rewards: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // Admin Functions
    async createPool() {
        try {
            if (!this.isAdmin) {
                this.showMessage('You are not authorized to perform this action', 'error');
                return;
            }
            
            const lpTokenAddress = document.getElementById('lpTokenAddress').value;
            const rewardRate = document.getElementById('rewardRate').value;
            const lockDuration = document.getElementById('lockDuration').value;
            
            if (!lpTokenAddress || !rewardRate || !lockDuration) {
                this.showMessage('Please fill in all fields', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const rewardRateWei = ethers.utils.parseEther(rewardRate);
            const lockDurationSeconds = parseInt(lockDuration) * 86400; // Convert days to seconds
            
            const tx = await this.contract.createPool(lpTokenAddress, rewardRateWei, lockDurationSeconds);
            
            this.showMessage('Transaction submitted! Waiting for confirmation...', 'warning');
            
            await tx.wait();
            
            this.showMessage('Pool created successfully!', 'success');
            
            // Clear inputs and reload data
            document.getElementById('lpTokenAddress').value = '';
            document.getElementById('rewardRate').value = '';
            document.getElementById('lockDuration').value = '';
            
            await this.loadPoolData();
            
        } catch (error) {
            console.error('Error creating pool:', error);
            this.showMessage('Failed to create pool: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async pausePool() {
        try {
            if (!this.isAdmin) {
                this.showMessage('You are not authorized to perform this action', 'error');
                return;
            }
            
            const poolId = document.getElementById('poolSelect').value;
            if (!poolId) {
                this.showMessage('Please select a pool', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const tx = await this.contract.pausePool(poolId);
            await tx.wait();
            
            this.showMessage('Pool paused successfully!', 'success');
            await this.loadPoolData();
            
        } catch (error) {
            console.error('Error pausing pool:', error);
            this.showMessage('Failed to pause pool: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async unpausePool() {
        try {
            if (!this.isAdmin) {
                this.showMessage('You are not authorized to perform this action', 'error');
                return;
            }
            
            const poolId = document.getElementById('poolSelect').value;
            if (!poolId) {
                this.showMessage('Please select a pool', 'error');
                return;
            }
            
            this.showLoading(true);
            
            const tx = await this.contract.unpausePool(poolId);
            await tx.wait();
            
            this.showMessage('Pool unpaused successfully!', 'success');
            await this.loadPoolData();
            
        } catch (error) {
            console.error('Error unpausing pool:', error);
            this.showMessage('Failed to unpause pool: ' + this.parseError(error), 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // Utility Functions
    disconnect() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.userAccount = null;
        this.isAdmin = false;
        
        document.getElementById('connectWallet').style.display = 'block';
        document.getElementById('walletInfo').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'none';
        
        this.showMessage('Wallet disconnected', 'warning');
    }

    showMessage(message, type = 'info') {
        const statusMessage = document.getElementById('statusMessage');
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 5000);
    }

    showLoading(show) {
        const loadingModal = document.getElementById('loadingModal');
        loadingModal.style.display = show ? 'flex' : 'none';
    }

    parseError(error) {
        if (error.reason) {
            return error.reason;
        } else if (error.message) {
            // Try to extract meaningful error message
            if (error.message.includes('user rejected')) {
                return 'Transaction was rejected';
            } else if (error.message.includes('insufficient funds')) {
                return 'Insufficient funds for transaction';
            } else if (error.message.includes('execution reverted')) {
                return 'Transaction failed - check contract conditions';
            }
            return error.message;
        }
        return 'Unknown error occurred';
    }

    updateUI() {
        // Add fade-in animation to cards
        const cards = document.querySelectorAll('.farm-card, .portfolio-card, .stat-card');
        cards.forEach((card, index) => {
            setTimeout(() => {
                card.classList.add('fade-in');
            }, index * 100);
        });
    }

    // Auto-refresh data every 30 seconds
    startAutoRefresh() {
        setInterval(async () => {
            if (this.contract && this.userAccount) {
                try {
                    await this.loadUserStakes();
                    await this.updateRealtimePendingRewards();
                } catch (error) {
                    console.error('Auto-refresh error:', error);
                }
            }
        }, 30000);
    }

    async updateRealtimePendingRewards() {
        try {
            const poolCount = await this.contract.getPoolCount();
            
            for (let i = 0; i < poolCount; i++) {
                const pendingRewards = await this.contract.pendingRewards(this.userAccount, i);
                const rewardElement = document.querySelector(`[data-pool="${i}"] .pending-rewards`);
                
                if (rewardElement && pendingRewards.gt(0)) {
                    rewardElement.textContent = `${ethers.utils.formatEther(pendingRewards)} YLD`;
                }
            }
        } catch (error) {
            console.error('Error updating pending rewards:', error);
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new YieldLockApp();
    app.startAutoRefresh();
    
    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });
});

// Export for potential external use
window.YieldLockApp = YieldLockApp;