;; police-chat.clar
;; Anonymous neighbourhood case reporting and chat between citizens and police officers.

;; --------------------------------------------
;; Constants & error codes
;; --------------------------------------------

(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_NOT_OFFICER (err u101))
(define-constant ERR_OFFICER_INACTIVE (err u102))
(define-constant ERR_CASE_NOT_FOUND (err u200))
(define-constant ERR_CASE_CLOSED (err u201))
(define-constant ERR_REGION_MISMATCH (err u202))

(define-constant STATUS_OPEN "open")
(define-constant STATUS_CLOSED "closed")

;; --------------------------------------------
;; Data definitions
;; --------------------------------------------

;; Admin address is set lazily on first privileged call.
(define-data-var admin (optional principal) none)

;; Incremental case id counter (starts at 1)
(define-data-var next-case-id uint u1)

;; Registered police officers keyed by principal
;; Each officer has a textual region and an `active` flag.
(define-map police-officers
  { officer: principal }
  { region: (string-ascii 32), active: bool })

;; Case metadata keyed by case-id
(define-map cases
  { case-id: uint }
  {
    region: (string-ascii 32),
    subject: (string-ascii 64),
    details: (string-utf8 256),
    ;; hash provided by the citizen (e.g. hash of a secret salt they keep off-chain)
    reporter-hash: (buff 32),
    assigned-officer: (optional principal),
    status: (string-ascii 16)
  })

;; Per-case message count, used to compute message indices
(define-map case-message-counts
  { case-id: uint }
  { count: uint })

;; Chat messages for each case, keyed by (case-id, index)
(define-map case-messages
  { case-id: uint, index: uint }
  {
    from-role: (string-ascii 8),            ;; "citizen" or "police"
    from-officer: (optional principal),     ;; only set for police messages
    content: (string-utf8 256),
    timestamp: uint                         ;; block height when message is stored
  })

;; --------------------------------------------
;; Internal helpers
;; --------------------------------------------

(define-private (assert-admin)
  (let ((maybe-admin (var-get admin)))
    (match maybe-admin
      stored-admin
        (if (is-eq tx-sender stored-admin)
            (ok true)
            ERR_UNAUTHORIZED)
      (begin
        ;; First privileged caller becomes admin.
        (var-set admin (some tx-sender))
        (ok true))))

(define-private (is-admin (who principal))
  (match (var-get admin)
    stored-admin (is-eq who stored-admin)
    false))

(define-private (assert-active-officer-or-admin)
  (if (is-admin tx-sender)
      (ok true)
      (match (map-get? police-officers { officer: tx-sender })
        officer-data
          (if (get active officer-data)
              (ok true)
              ERR_OFFICER_INACTIVE)
        ERR_NOT_OFFICER)))

(define-private (get-next-message-index (case-id uint))
  (match (map-get? case-message-counts { case-id: case-id })
    entry
      (let ((i (get count entry)))
        (begin
          (map-set case-message-counts { case-id: case-id } { count: (+ i u1) })
          i))
    (begin
      (map-set case-message-counts { case-id: case-id } { count: u1 })
      u0)))

(define-private (assert-case-open (case-id uint))
  (match (map-get? cases { case-id: case-id })
    case-data
      (if (is-eq (get status case-data) STATUS_OPEN)
          (ok case-data)
          ERR_CASE_CLOSED)
    ERR_CASE_NOT_FOUND))

(define-private (assert-can-close (case-id uint))
  (match (map-get? cases { case-id: case-id })
    case-data
      (if (not (is-eq (get status case-data) STATUS_OPEN))
          ERR_CASE_CLOSED
          (let ((assigned (get assigned-officer case-data)))
            (if (or (is-admin tx-sender)
                    (match assigned assigned-officer
                      (is-eq tx-sender assigned-officer)
                      false))
                (ok true)
                ERR_UNAUTHORIZED)))
    ERR_CASE_NOT_FOUND))

;; --------------------------------------------
;; Public functions
;; --------------------------------------------

;; Admin registers or updates a police officer
(define-public (register-police (officer principal) (region (string-ascii 32)))
  (begin
    (try! (assert-admin))
    (map-set police-officers
      { officer: officer }
      { region: region, active: true })
    (ok true)))

;; Admin activates or deactivates an officer
(define-public (set-officer-active (officer principal) (active bool))
  (begin
    (try! (assert-admin))
    (match (map-get? police-officers { officer: officer })
      officer-data
        (begin
          (map-set police-officers
            { officer: officer }
            { region: (get region officer-data),
              active: active })
          (ok true))
      ERR_NOT_OFFICER)))

;; Citizen opens a new case.
;; `salt` is arbitrary data chosen off-chain by the citizen and hashed on-chain
;; to avoid storing their explicit identity in contract state.
(define-public (open-case
    (region (string-ascii 32))
    (subject (string-ascii 64))
    (details (string-utf8 256))
    (salt (buff 32)))
  (let
    ((case-id (var-get next-case-id))
     (reporter-hash (sha256 salt)))
    (begin
      (var-set next-case-id (+ case-id u1))
      (map-set cases
        { case-id: case-id }
        {
          region: region,
          subject: subject,
          details: details,
          reporter-hash: reporter-hash,
          assigned-officer: none,
          status: STATUS_OPEN
        })
      (ok case-id))))

;; Admin assigns a case to an officer.
(define-public (assign-case (case-id uint) (officer principal))
  (begin
    (try! (assert-admin))
    (match (map-get? police-officers { officer: officer })
      officer-data
        (if (not (get active officer-data))
            ERR_OFFICER_INACTIVE
            (match (map-get? cases { case-id: case-id })
              case-data
                (if (is-eq (get region case-data) (get region officer-data))
                    (begin
                      (map-set cases { case-id: case-id }
                        {
                          region: (get region case-data),
                          subject: (get subject case-data),
                          details: (get details case-data),
                          reporter-hash: (get reporter-hash case-data),
                          assigned-officer: (some officer),
                          status: (get status case-data)
                        })
                      (ok true))
                    ERR_REGION_MISMATCH)
              ERR_CASE_NOT_FOUND))
      ERR_NOT_OFFICER)))

;; Messaging, closing, and read-only helpers are defined below.
;; (Temporarily removed or simplified during debugging.)
