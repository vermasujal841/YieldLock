// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract YieldLock is ReentrancyGuard, Ownable {
    IERC20 public stakingToken;
    IERC20 public rewardToken;

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 vestingDuration;
        bool isActive;
    }

    struct FarmPool {
        IERC20 lpToken;
        uint256 totalStaked;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 lockDuration;
        bool isActive;
    }

    struct UserStake {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lockEndTime;
        uint256 vestingScheduleId;
    }

    mapping(uint256 => FarmPool) public farmPools;
    mapping(uint256 => mapping(address => UserStake)) public userStakes;
    mapping(address => mapping(uint256 => VestingSchedule)) public vestingSchedules;
    mapping(address => uint256) public userVestingCount;

    uint256 public poolCounter;

    event PoolCreated(uint256 indexed poolId, address lpToken, uint256 rewardRate, uint256 lockDuration);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount);
    event Unstaked(uint256 indexed poolId, address indexed user, uint256 amount);
    event VestingScheduleCreated(address indexed beneficiary, uint256 vestingId, uint256 amount);
    event TokensVested(address indexed beneficiary, uint256 vestingId, uint256 amount);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    function createFarmPool(
        address lpToken,
        uint256 rewardRate,
        uint256 lockDuration
    ) external onlyOwner {
        require(lpToken != address(0), "Invalid LP token address");
        require(rewardRate > 0, "Reward rate must be greater than 0");

        poolCounter++;
        farmPools[poolCounter] = FarmPool({
            lpToken: IERC20(lpToken),
            totalStaked: 0,
            rewardRate: rewardRate,
            lastUpdateTime: block.timestamp,
            rewardPerTokenStored: 0,
            lockDuration: lockDuration,
            isActive: true
        });

        emit PoolCreated(poolCounter, lpToken, rewardRate, lockDuration);
    }

    function setFarmPoolParams(
        uint256 poolId,
        uint256 newRewardRate,
        uint256 newLockDuration
    ) external onlyOwner {
        FarmPool storage pool = farmPools[poolId];
        require(pool.isActive, "Pool not active");
        require(newRewardRate > 0, "Reward rate must be greater than 0");

        updatePoolReward(poolId);
        pool.rewardRate = newRewardRate;
        pool.lockDuration = newLockDuration;
    }

    function stakeLiquidity(uint256 poolId, uint256 amount) external nonReentrant {
        FarmPool storage pool = farmPools[poolId];
        require(pool.isActive, "Pool not active");
        require(amount > 0, "Amount must be greater than 0");

        updatePoolReward(poolId);

        UserStake storage userStake = userStakes[poolId][msg.sender];
        userStake.amount += amount;
        userStake.lockEndTime = block.timestamp + pool.lockDuration;
        userStake.rewardDebt = (userStake.amount * pool.rewardPerTokenStored) / 1e18;

        pool.totalStaked += amount;

        require(pool.lpToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        emit Staked(poolId, msg.sender, amount);
    }

    function unstakeLiquidity(uint256 poolId, uint256 amount) external nonReentrant {
        FarmPool storage pool = farmPools[poolId];
        UserStake storage userStake = userStakes[poolId][msg.sender];

        require(userStake.amount >= amount, "Insufficient staked amount");
        require(block.timestamp >= userStake.lockEndTime, "Tokens still locked");

        updatePoolReward(poolId);

        uint256 pendingRewards = earned(poolId, msg.sender);
        if (pendingRewards > 0) {
            createVestingSchedule(msg.sender, pendingRewards);
        }

        userStake.amount -= amount;
        pool.totalStaked -= amount;
        userStake.rewardDebt = (userStake.amount * pool.rewardPerTokenStored) / 1e18;

        require(pool.lpToken.transfer(msg.sender, amount), "Transfer failed");

        emit Unstaked(poolId, msg.sender, amount);
    }

    function createVestingSchedule(address beneficiary, uint256 amount) internal {
        uint256 vestingId = userVestingCount[beneficiary]++;
        vestingSchedules[beneficiary][vestingId] = VestingSchedule({
            totalAmount: amount,
            claimedAmount: 0,
            startTime: block.timestamp,
            cliffDuration: 30 days,
            vestingDuration: 180 days,
            isActive: true
        });

        emit VestingScheduleCreated(beneficiary, vestingId, amount);
    }

    function claimVestedTokens(uint256 vestingId) external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[msg.sender][vestingId];
        require(schedule.isActive, "Vesting not active");

        uint256 claimableAmount = calculateVestedAmount(msg.sender, vestingId);
        require(claimableAmount > 0, "Nothing to claim");

        schedule.claimedAmount += claimableAmount;
        if (schedule.claimedAmount >= schedule.totalAmount) {
            schedule.isActive = false;
        }

        require(rewardToken.transfer(msg.sender, claimableAmount), "Transfer failed");

        emit TokensVested(msg.sender, vestingId, claimableAmount);
    }

    function calculateVestedAmount(address beneficiary, uint256 vestingId) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[beneficiary][vestingId];

        if (block.timestamp < schedule.startTime + schedule.cliffDuration) return 0;

        uint256 timeElapsed = block.timestamp - schedule.startTime;

        if (timeElapsed >= schedule.vestingDuration) {
            return schedule.totalAmount - schedule.claimedAmount;
        }

        uint256 vested = (schedule.totalAmount * timeElapsed) / schedule.vestingDuration;
        return vested - schedule.claimedAmount;
    }

    function earned(uint256 poolId, address user) public view returns (uint256) {
        FarmPool storage pool = farmPools[poolId];
        UserStake storage stake = userStakes[poolId][user];

        uint256 currentRewardPerToken = rewardPerToken(poolId);
        return ((stake.amount * (currentRewardPerToken - stake.rewardDebt)) / 1e18);
    }

    function rewardPerToken(uint256 poolId) public view returns (uint256) {
        FarmPool storage pool = farmPools[poolId];

        if (pool.totalStaked == 0) return pool.rewardPerTokenStored;

        return pool.rewardPerTokenStored +
            (((block.timestamp - pool.lastUpdateTime) * pool.rewardRate * 1e18) / pool.totalStaked);
    }
function getActiveVestingSchedules(address user) external view returns (
    uint256[] memory ids,
    uint256[] memory totalAmounts,
    uint256[] memory claimedAmounts,
    uint256[] memory claimableNow,
    uint256[] memory timeRemaining
) {
    uint256 count = userVestingCount[user];
    uint256 activeCount;

    // First pass: count active
    for (uint256 i = 0; i < count; i++) {
        if (vestingSchedules[user][i].isActive) {
            activeCount++;
        }
    }

    // Initialize arrays
    ids = new uint256[](activeCount);
    totalAmounts = new uint256[](activeCount);
    claimedAmounts = new uint256[](activeCount);
    claimableNow = new uint256[](activeCount);
    timeRemaining = new uint256[](activeCount);

    // Second pass: fill data
    uint256 index;
    for (uint256 i = 0; i < count; i++) {
        VestingSchedule storage vs = vestingSchedules[user][i];
        if (vs.isActive) {
            ids[index] = i;
            totalAmounts[index] = vs.totalAmount;
            claimedAmounts[index] = vs.claimedAmount;
            claimableNow[index] = calculateVestedAmount(user, i);
            uint256 end = vs.startTime + vs.vestingDuration;
            timeRemaining[index] = block.timestamp >= end ? 0 : end - block.timestamp;
            index++;
        }
    }
}



}
