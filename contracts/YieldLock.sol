     // SPDX-License-Identifier MIT//
pragma solidity ^0.8.17;
    
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract YieldLock is ReentrancyGuard, Ownable {
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
        
    struct VestingSchedule {
        uint256 totalAmount;     
        uint256 claimedAmount;   
        uint256 startTime;
        uint256 cliff;    
        uint256 duration;
        bool isActive;
    }

    struct FarmPool {
        IERC20 stakingToken;
        uint256 totalStaked;
        uint256 rewardRate;
        uint256 lastUpdated;
        uint256 rewardPerTokenStored;
        uint256 lockDuration;
        bool isActive;
    }
   
    struct UserStake {
        uint256 stakedAmount;
        uint256 rewardDebt;
        uint256 unlockTime;
        uint256 vestingId;
    }

    uint256 public poolCount;

    mapping(uint256 => FarmPool) public pools;
    mapping(uint256 => mapping(address => UserStake)) public userStakes;
    mapping(address => mapping(uint256 => VestingSchedule)) public vestings;
    mapping(address => uint256) public vestingCounter;

    event PoolCreated(uint256 indexed poolId, address indexed token, uint256 rewardRate, uint256 lockDuration);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount);
    event Unstaked(uint256 indexed poolId, address indexed user, uint256 amount);
    event VestingCreated(address indexed user, uint256 vestingId, uint256 amount);
    event TokensClaimed(address indexed user, uint256 vestingId, uint256 amount);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        require(_stakingToken != address(0) && _rewardToken != address(0), "Zero address");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    // --- Pool Management ---

    function createPool(address token, uint256 rewardRate, uint256 lockDuration) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(rewardRate > 0, "Reward rate must be > 0");

        poolCount++;      
        pools[poolCount] = FarmPool({
            stakingToken: IERC20(token),
            totalStaked: 0,
            rewardRate: rewardRate,
            lastUpdated: block.timestamp,
            rewardPerTokenStored: 0,
            lockDuration: lockDuration,
            isActive: true
        });

        emit PoolCreated(poolCount, token, rewardRate, lockDuration);
    }

    function updatePool(uint256 poolId, uint256 newRate, uint256 newLock) external onlyOwner {
        FarmPool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(newRate > 0, "Reward rate must be > 0");

        _updatePool(poolId);
        pool.rewardRate = newRate;
        pool.lockDuration = newLock;
    }

    // --- Staking ---

    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        require(amount > 0, "Stake amount must be > 0");

        FarmPool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");

        _updatePool(poolId);

        UserStake storage user = userStakes[poolId][msg.sender];
        user.stakedAmount += amount;
        user.unlockTime = block.timestamp + pool.lockDuration;
        user.rewardDebt = (user.stakedAmount * pool.rewardPerTokenStored) / 1e18;

        pool.totalStaked += amount;
        require(pool.stakingToken.transferFrom(msg.sender, address(this), amount), "Stake transfer failed");

        emit Staked(poolId, msg.sender, amount);
    }
      
    function unstake(uint256 poolId, uint256 amount) external nonReentrant {
        FarmPool storage pool = pools[poolId];
        UserStake storage user = userStakes[poolId][msg.sender];

        require(user.stakedAmount >= amount, "Insufficient stake");
        require(block.timestamp >= user.unlockTime, "Stake is still locked");

        _updatePool(poolId);

        uint256 rewards = _earned(poolId, msg.sender);
        if (rewards > 0) {
            _startVesting(msg.sender, rewards);
        }

        user.stakedAmount -= amount;
        user.rewardDebt = (user.stakedAmount * pool.rewardPerTokenStored) / 1e18;
        pool.totalStaked -= amount;

        require(pool.stakingToken.transfer(msg.sender, amount), "Unstake transfer failed");

        emit Unstaked(poolId, msg.sender, amount);
    }

    // --- Vesting ---

    function claimVested(uint256 vestingId) external nonReentrant {
        VestingSchedule storage vs = vestings[msg.sender][vestingId];
        require(vs.isActive, "Vesting not active");

        uint256 claimable = _vestedAmount(msg.sender, vestingId);
        require(claimable > 0, "No tokens claimable");

        vs.claimedAmount += claimable;
        if (vs.claimedAmount >= vs.totalAmount) {
            vs.isActive = false;
        }

        require(rewardToken.transfer(msg.sender, claimable), "Claim transfer failed");

        emit TokensClaimed(msg.sender, vestingId, claimable);
    }

    function _startVesting(address user, uint256 amount) internal {
        uint256 id = vestingCounter[user]++;
        vestings[user][id] = VestingSchedule({
            totalAmount: amount,
            claimedAmount: 0,
            startTime: block.timestamp,
            cliff: 30 days,
            duration: 180 days,
            isActive: true
        });

        emit VestingCreated(user, id, amount);
    }

    function _vestedAmount(address user, uint256 id) public view returns (uint256) {
        VestingSchedule storage vs = vestings[user][id];
        if (block.timestamp < vs.startTime + vs.cliff) return 0;

        uint256 elapsed = block.timestamp - vs.startTime;
        if (elapsed >= vs.duration) {
            return vs.totalAmount - vs.claimedAmount;
        }

        uint256 vested = (vs.totalAmount * elapsed) / vs.duration;
        return vested - vs.claimedAmount;
    }

    // --- Reward Calculation ---

    function _earned(uint256 poolId, address user) public view returns (uint256) {
        FarmPool storage pool = pools[poolId];
        UserStake storage stakeData = userStakes[poolId][user];

        uint256 newRewardPerToken = _rewardPerToken(poolId);
        return (stakeData.stakedAmount * (newRewardPerToken - stakeData.rewardDebt)) / 1e18;
    }

    function _rewardPerToken(uint256 poolId) public view returns (uint256) {
        FarmPool storage pool = pools[poolId];
        if (pool.totalStaked == 0) return pool.rewardPerTokenStored;

        uint256 timeDiff = block.timestamp - pool.lastUpdated;
        return pool.rewardPerTokenStored + ((timeDiff * pool.rewardRate * 1e18) / pool.totalStaked);
    }

    function _updatePool(uint256 poolId) internal {
        FarmPool storage pool = pools[poolId];
        if (block.timestamp > pool.lastUpdated) {
            pool.rewardPerTokenStored = _rewardPerToken(poolId);
            pool.lastUpdated = block.timestamp;
        }
    }

    // --- Vesting Info View ---

    function getUserVestings(address user) external view returns (
        uint256[] memory ids,
        uint256[] memory totals,
        uint256[] memory claimed,
        uint256[] memory claimables,
        uint256[] memory timeLeft
    ) {
        uint256 count = vestingCounter[user];
        uint256 active = 0;

        for (uint256 i = 0; i < count; i++) {
            if (vestings[user][i].isActive) active++;
        }

        ids = new uint256[](active);
        totals = new uint256[](active);
        claimed = new uint256[](active);
        claimables = new uint256[](active);
        timeLeft = new uint256[](active);

        uint256 index = 0;
        for (uint256 i = 0; i < count; i++) {
            VestingSchedule storage vs = vestings[user][i];
            if (vs.isActive) {
                ids[index] = i;
                totals[index] = vs.totalAmount;
                claimed[index] = vs.claimedAmount;
                claimables[index] = _vestedAmount(user, i);
                uint256 endTime = vs.startTime + vs.duration;
                timeLeft[index] = block.timestamp >= endTime ? 0 : endTime - block.timestamp;
                index++;
            }
        }
    }
}
