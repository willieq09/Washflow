# AutoLux Security Specification

## 1. Data Invariants
- A **User Profile** must have a valid `uid` matching the authentication context, a `role`, and a `createdAt` timestamp.
- A **Booking** MUST belong to a valid `userId` (the customer) and a `businessId` (the wash station).
- A **Booking** status transition is strictly defined: `pending` -> `confirmed` | `canceled` -> `completed`.
- A **Vehicle** must belong to a `userId`.
- **Washes** (Service Logs) must be created by a `worker` or `admin` and refer to a valid `bookingId` or vehicle.
- **Incentives** can ONLY be created by `admin`.

## 2. The "Dirty Dozen" Payloads (Attack Vectors)
1. **Identity Spoofing**: Attempting to create a booking for another user (`userId` mismatch).
2. **Role Escalation**: Attempting to update own `role` to `admin` or `owner`.
3. **Ghost Bookings**: Creating a booking with a junk `businessId` that doesn't exist.
4. **Price Manipulation**: Creating a booking with `price: 0` or negative.
5. **State Skipping**: Updating a booking status directly from `pending` to `completed` without worker intervention.
6. **PII Leak**: A worker attempting to read the full `email` and `phone` of all customers without a specific booking context.
7. **Resource Poisoning**: Injecting 1MB of junk characters into the `vehicleInfo` string.
8. **Unauthorized Deletion**: A customer attempting to delete their subscription or booking (only `canceled` status allowed).
9. **Timestamp Fraud**: Setting `createdAt` to a future date instead of `request.time`.
10. **Shadow Fields**: Adding `isVerified: true` to a vehicle doc to bypass verification.
11. **Query Scraping**: Attempting to list ALL bookings in the system without a `userId` or `businessId` filter.
12. **Orphaned Writes**: Creating a review for a booking that doesn't exist.

## 3. The Test Plan
Detailed validation rules will be implemented in `firestore.rules` and verified via manual audit (Red Team) and code consistency checks.
- All `create` operations must pass `isValid[Entity]()`.
- All `update` operations must use `affectedKeys().hasOnly()` to restrict state transitions.
- All `read` operations must be owner-restricted or role-restricted (Admin/Owner).
